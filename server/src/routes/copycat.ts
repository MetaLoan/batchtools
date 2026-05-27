import type { FastifyInstance } from 'fastify';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { db } from '../db/index.js';
import {
  tkBloggers,
  crawledVideos,
  copycatStrategies,
  copycatProcessedVideos,
} from '../db/schema.js';
import { crawlBloggerVideos, crawlAllActiveBloggers } from '../services/tk-crawler.js';
import { checkAndRunCopycatStrategies } from '../services/copycat-service.js';

interface CreateBloggerBody {
  homepageUrl: string;
}

interface CreateStrategyBody {
  id?: string;
  accountId: string;
  name: string;
  type: string;
  bloggerIds: string[];
  filterMinDuration?: number;
  filterMaxDuration?: number;
  filterPublishAfter?: number;
  filterMinPlayCount?: number;
  filterDeduplicate?: boolean;
  refImageUrl: string;
  persona: string;
  stylePrompt: string;
  outputCount?: number;
  reuseAudio?: boolean;
  crawlIntervalHours?: number;
}

export async function copycatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // --- TK博主库 CRUD ---

  // 1. 获取博主列表
  app.get('/v1/tk_bloggers', async (req) => {
    return db
      .select()
      .from(tkBloggers)
      .where(eq(tkBloggers.userId, req.currentUser!.id))
      .orderBy(desc(tkBloggers.createdAt))
      .all();
  });

  // 2. 添加博主
  app.post('/v1/tk_bloggers', async (req, reply) => {
    const { homepageUrl } = req.body as CreateBloggerBody;
    if (!homepageUrl) {
      reply.code(400).send({ error: 'Missing homepageUrl' });
      return;
    }

    // Extract handle or nickname from URL
    // e.g. https://www.tiktok.com/@username -> @username
    let handle = homepageUrl.split('/@')?.[1]?.split('?')?.[0] || '';
    if (!handle) {
      // fallback
      handle = homepageUrl.match(/tiktok\.com\/([a-zA-Z0-9._-]+)/)?.[1] || '';
      if (!handle.startsWith('@')) handle = '@' + handle;
    } else {
      handle = '@' + handle;
    }

    if (!handle || handle === '@') {
      reply.code(400).send({ error: '无法解析合法的 TikTok 博主链接' });
      return;
    }

    const id = nanoid();
    const now = Date.now();

    try {
      db.insert(tkBloggers)
        .values({
          id,
          userId: req.currentUser!.id,
          homepageUrl,
          handle,
          nickname: handle.slice(1),
          status: 'active',
          createdAt: now,
        })
        .run();

      // Trigger initial metadata/profile crawl in background immediately
      crawlBloggerVideos(id, req.currentUser!.id).catch((err) => {
        console.error(`[copycat-route] Initial metadata crawl failed for ${handle}:`, err);
      });

      const created = db.select().from(tkBloggers).where(eq(tkBloggers.id, id)).get();
      reply.code(201).send(created);
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 3. 删除博主
  app.delete('/v1/tk_bloggers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const blogger = db
      .select()
      .from(tkBloggers)
      .where(and(eq(tkBloggers.id, id), eq(tkBloggers.userId, req.currentUser!.id)))
      .get();

    if (!blogger) {
      reply.code(404).send({ error: 'Blogger not found' });
      return;
    }

    try {
      db.delete(tkBloggers).where(eq(tkBloggers.id, id)).run();
      db.delete(crawledVideos).where(eq(crawledVideos.bloggerId, id)).run();
      reply.send({ ok: true });
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 4. 手动触发同步博主视频
  app.post('/v1/tk_bloggers/:id/sync', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const added = await crawlBloggerVideos(id, req.currentUser!.id);
      reply.send({ ok: true, crawledCount: added.length });
    } catch (err: any) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 5. 获取特定博主的已采集视频列表
  app.get('/v1/tk_bloggers/:id/videos', async (req, reply) => {
    const { id } = req.params as { id: string };
    const blogger = db
      .select()
      .from(tkBloggers)
      .where(and(eq(tkBloggers.id, id), eq(tkBloggers.userId, req.currentUser!.id)))
      .get();

    if (!blogger) {
      reply.code(404).send({ error: 'Blogger not found' });
      return;
    }

    const videos = db
      .select()
      .from(crawledVideos)
      .where(eq(crawledVideos.bloggerId, id))
      .orderBy(desc(crawledVideos.publishTime))
      .all();

    reply.send({ videos });
  });

  // --- 同款策略 CRUD ---

  // 1. 获取策略列表
  app.get('/v1/copycat_strategies', async (req) => {
    return db
      .select()
      .from(copycatStrategies)
      .where(eq(copycatStrategies.userId, req.currentUser!.id))
      .orderBy(desc(copycatStrategies.createdAt))
      .all();
  });

  // 2. 创建或更新策略
  app.post('/v1/copycat_strategies', async (req, reply) => {
    const body = req.body as CreateStrategyBody;
    const {
      id: existingId,
      accountId,
      name,
      type,
      bloggerIds,
      filterMinDuration,
      filterMaxDuration,
      filterPublishAfter,
      filterMinPlayCount,
      filterDeduplicate = true,
      refImageUrl,
      persona,
      stylePrompt,
      outputCount = 1,
      reuseAudio = true,
      crawlIntervalHours = 6,
    } = body;

    if (!accountId || !name || !type || !bloggerIds || bloggerIds.length === 0 || !refImageUrl || !persona || !stylePrompt) {
      reply.code(400).send({ error: 'Missing required parameters' });
      return;
    }

    const now = Date.now();
    let id = existingId;

    try {
      if (id) {
        // Update Strategy
        const existing = db
          .select()
          .from(copycatStrategies)
          .where(eq(copycatStrategies.id, id))
          .get();

        if (!existing || existing.userId !== req.currentUser!.id) {
          reply.code(404).send({ error: 'Strategy not found or unauthorized' });
          return;
        }

        db.update(copycatStrategies)
          .set({
            name,
            accountId,
            type,
            bloggerIdsJson: JSON.stringify(bloggerIds),
            filterMinDuration: filterMinDuration ?? null,
            filterMaxDuration: filterMaxDuration ?? null,
            filterPublishAfter: filterPublishAfter ?? null,
            filterMinPlayCount: filterMinPlayCount ?? null,
            filterDeduplicate: filterDeduplicate ? 1 : 0,
            refImageUrl,
            persona,
            stylePrompt,
            outputCount,
            reuseAudio: reuseAudio ? 1 : 0,
            crawlIntervalHours,
          })
          .where(eq(copycatStrategies.id, id))
          .run();
      } else {
        // Create Strategy
        id = nanoid();
        db.insert(copycatStrategies)
          .values({
            id,
            userId: req.currentUser!.id,
            accountId,
            name,
            type,
            bloggerIdsJson: JSON.stringify(bloggerIds),
            filterMinDuration: filterMinDuration ?? null,
            filterMaxDuration: filterMaxDuration ?? null,
            filterPublishAfter: filterPublishAfter ?? null,
            filterMinPlayCount: filterMinPlayCount ?? null,
            filterDeduplicate: filterDeduplicate ? 1 : 0,
            refImageUrl,
            persona,
            stylePrompt,
            outputCount,
            reuseAudio: reuseAudio ? 1 : 0,
            crawlIntervalHours,
            status: 'active',
            createdAt: now,
          })
          .run();
      }

      const created = db.select().from(copycatStrategies).where(eq(copycatStrategies.id, id)).get();
      reply.code(201).send(created);
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 3. 启停策略
  app.post('/v1/copycat_strategies/:id/toggle', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db
      .select()
      .from(copycatStrategies)
      .where(and(eq(copycatStrategies.id, id), eq(copycatStrategies.userId, req.currentUser!.id)))
      .get();

    if (!existing) {
      reply.code(404).send({ error: 'Strategy not found' });
      return;
    }

    const nextStatus = existing.status === 'active' ? 'paused' : 'active';
    try {
      db.update(copycatStrategies)
        .set({ status: nextStatus })
        .where(eq(copycatStrategies.id, id))
        .run();
      reply.send({ ok: true, status: nextStatus });
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 4. 删除策略
  app.delete('/v1/copycat_strategies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = db
      .select()
      .from(copycatStrategies)
      .where(and(eq(copycatStrategies.id, id), eq(copycatStrategies.userId, req.currentUser!.id)))
      .get();

    if (!existing) {
      reply.code(404).send({ error: 'Strategy not found' });
      return;
    }

    try {
      db.delete(copycatStrategies).where(eq(copycatStrategies.id, id)).run();
      db.delete(copycatProcessedVideos).where(eq(copycatProcessedVideos.strategyId, id)).run();
      reply.send({ ok: true });
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  // 5. 手动运行策略检测/生成
  app.post('/v1/copycat_strategies/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const processedCount = await checkAndRunCopycatStrategies(req.currentUser!.id, true, id);
      reply.send({ ok: true, processedCount });
    } catch (err: any) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 6. 获取特定策略的已处理视频记录与生成 Job 关联
  app.get('/v1/copycat_strategies/:id/logs', async (req, reply) => {
    const { id } = req.params as { id: string };
    const logs = db
      .select({
        strategyId: copycatProcessedVideos.strategyId,
        videoUniqueId: copycatProcessedVideos.videoUniqueId,
        jobId: copycatProcessedVideos.jobId,
        processedAt: copycatProcessedVideos.processedAt,
        videoTitle: crawledVideos.title,
        videoUrl: crawledVideos.videoUrl,
        downloadUrl: crawledVideos.downloadUrl,
      })
      .from(copycatProcessedVideos)
      .leftJoin(crawledVideos, eq(crawledVideos.uniqueId, copycatProcessedVideos.videoUniqueId))
      .where(eq(copycatProcessedVideos.strategyId, id))
      .orderBy(desc(copycatProcessedVideos.processedAt))
      .all();
    reply.send({ logs });
  });

  // 7. 获取当前爬虫与登录 Cookie 设置状态
  app.get('/v1/crawler/settings', async (req) => {
    const browser = process.env.TIKTOK_COOKIES_FROM_BROWSER || '';
    const envFile = process.env.TIKTOK_COOKIES_FILE || '';
    const defaultCookiesPath = path.join(config.dataDir, 'cookies.txt');
    const actualCookiesFile = envFile || defaultCookiesPath;
    let hasCustomCookiesFile = false;
    let cookiesText = '';

    if (fs.existsSync(actualCookiesFile)) {
      hasCustomCookiesFile = true;
      try {
        cookiesText = fs.readFileSync(actualCookiesFile, 'utf8');
      } catch {}
    }

    // Mask proxy password for security
    let proxy = process.env.ALL_PROXY || '';
    if (proxy) {
      proxy = proxy.replace(/(socks5:\/\/.*?):(.*?)@/, '$1:******@');
    }

    return {
      proxy,
      cookiesFromBrowser: browser,
      hasCustomCookiesFile,
      cookiesText,
    };
  });

  // 8. 更新爬虫登录 Cookie
  app.post('/v1/crawler/settings', async (req, reply) => {
    const { cookiesText } = req.body as { cookiesText: string };
    const envFile = process.env.TIKTOK_COOKIES_FILE || '';
    const defaultCookiesPath = path.join(config.dataDir, 'cookies.txt');
    const targetFile = envFile || defaultCookiesPath;

    try {
      if (cookiesText && cookiesText.trim()) {
        fs.writeFileSync(targetFile, cookiesText.trim(), 'utf8');
      } else {
        if (fs.existsSync(targetFile)) {
          fs.unlinkSync(targetFile);
        }
      }

      // Trigger sync for all active bloggers immediately to clear errors
      crawlAllActiveBloggers(req.currentUser!.id).catch((err) => {
        console.error('[copycat-route] Async sync bloggers after setting cookies failed:', err);
      });

      return { ok: true };
    } catch (err: any) {
      reply.code(500).send({ error: err.message });
    }
  });
}
