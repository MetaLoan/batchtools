import type { FastifyInstance } from 'fastify';
import { eq, desc, and, like } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { requireAuth } from '../lib/auth.js';
import { db } from '../db/index.js';
import { strategies, uploads } from '../db/schema.js';
import { generateScripts } from '../services/llm-service.js';
import { createJob } from '../services/job-service.js';
import { accountExists } from '../services/account-service.js';

interface CreateStrategyBody {
  name: string;
  refImageUrl: string;
  persona: string;
  duration: number;
  capabilityId: string;
  modelVariant: string;
  audioMode?: string;
  scenePreference?: string;
}

interface GenerateBody {
  count: number;
}

interface PromptItem {
  title: string;
  prompt: string;
}

interface ExecuteBody {
  accountId: string;
  prompts: PromptItem[];
}

export async function strategyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // 1. 获取用户的所有策略
  app.get('/v1/strategies', async (req) => {
    return db
      .select()
      .from(strategies)
      .where(eq(strategies.userId, req.currentUser!.id))
      .orderBy(desc(strategies.createdAt))
      .all();
  });

  // 2. 新建策略
  app.post('/v1/strategies', async (req, reply) => {
    const {
      name,
      refImageUrl,
      persona,
      duration = 10,
      capabilityId,
      modelVariant,
      audioMode = 'none',
      scenePreference,
    } = req.body as CreateStrategyBody;

    if (!name || !refImageUrl || !persona || !capabilityId || !modelVariant) {
      reply.code(400).send({ error: 'Missing required strategy parameters' });
      return;
    }

    const id = nanoid();
    const now = Date.now();

    try {
      db.insert(strategies)
        .values({
          id,
          userId: req.currentUser!.id,
          name,
          refImageUrl,
          persona,
          duration,
          capabilityId,
          modelVariant,
          audioMode,
          scenePreference,
          createdAt: now,
        })
        .run();

      const created = db.select().from(strategies).where(eq(strategies.id, id)).get();
      reply.code(201).send(created);
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 3. 删除策略
  app.delete('/v1/strategies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const existing = db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id))
      .get();

    if (!existing || existing.userId !== req.currentUser!.id) {
      reply.code(404).send({ error: 'Strategy not found' });
      return;
    }

    try {
      db.delete(strategies).where(eq(strategies.id, id)).run();
      reply.send({ ok: true });
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 4. 使用 Grok 生成剧本提示词
  app.post('/v1/strategies/:id/generate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { count = 3 } = (req.body ?? {}) as GenerateBody;

    const strategy = db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id))
      .get();

    if (!strategy || strategy.userId !== req.currentUser!.id) {
      reply.code(404).send({ error: 'Strategy not found' });
      return;
    }

    try {
      app.log.info(`[strategy] Calling Grok to generate ${count} scripts for strategy ${id}`);
      const scripts = await generateScripts({
        persona: strategy.persona,
        refImageUrl: strategy.refImageUrl,
        duration: strategy.duration,
        count,
        scenePreference: strategy.scenePreference || undefined,
      });
      reply.send({ scripts });
    } catch (e: any) {
      app.log.error(`[strategy] Grok script generation failed:`, e);
      reply.code(500).send({ error: e.message || 'LLM generation failed' });
    }
  });

  // 5. 一键批量下发视频任务到队列中
  app.post('/v1/strategies/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { accountId, prompts } = req.body as ExecuteBody;

    if (!accountId || !prompts || prompts.length === 0) {
      reply.code(400).send({ error: 'Missing accountId or prompts list' });
      return;
    }

    if (!accountExists(accountId)) {
      reply.code(400).send({ error: 'Account does not exist' });
      return;
    }

    const strategy = db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id))
      .get();

    if (!strategy || strategy.userId !== req.currentUser!.id) {
      reply.code(404).send({ error: 'Strategy not found' });
      return;
    }

    try {
      app.log.info(`[strategy] Bulk executing ${prompts.length} video generation jobs for strategy ${id}`);
      
      // Query random audio if enabled
      let randomAudioUrl: string | null = null;
      if (strategy.audioMode === 'random') {
        const userAudios = db
          .select()
          .from(uploads)
          .where(
            and(
              eq(uploads.userId, req.currentUser!.id),
              like(uploads.mime, 'audio/%')
            )
          )
          .all();
        if (userAudios.length > 0) {
          const randomIndex = Math.floor(Math.random() * userAudios.length);
          randomAudioUrl = userAudios[randomIndex].publicUrl;
          app.log.info(`[strategy] Selected random audio: ${randomAudioUrl}`);
        }
      }

      const jobIds: string[] = [];

      for (const item of prompts) {
        const baseMedia: any[] = [
          {
            localId: 'image_ref',
            kind: 'reference_image',
            url: strategy.refImageUrl,
          }
        ];
        
        if (randomAudioUrl) {
          baseMedia.push({
            kind: 'reference_voice',
            url: randomAudioUrl,
            boundTo: 'image_ref',
          });
        }

        const job = createJob({
          userId: req.currentUser!.id,
          accountId,
          capabilityId: strategy.capabilityId as any,
          modelVariant: strategy.modelVariant,
          basePrompt: item.prompt,
          baseNegativePrompt: '',
          baseMedia,
          baseParameters: {
            'parameters.duration': strategy.duration,
            ...(strategy.capabilityId === 'wan2.6.r2v'
              ? { 'parameters.size': '1080*1920' }
              : strategy.capabilityId === 'wan2.7.r2v'
                ? { 'parameters.ratio': '9:16' }
                : {}),
          },
          batchMatrix: { axes: [] },
        });
        jobIds.push(job.jobId);
      }

      reply.code(201).send({ ok: true, jobIds });
    } catch (e: any) {
      app.log.error(`[strategy] Bulk execution failed:`, e);
      reply.code(500).send({ error: e.message || 'Failed to submit batch jobs' });
    }
  });
}
