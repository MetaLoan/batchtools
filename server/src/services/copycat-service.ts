import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
const execPromise = promisify(exec);
import { nanoid } from 'nanoid';
import { request } from 'undici';
import { db } from '../db/index.js';
import {
  tkBloggers,
  crawledVideos,
  copycatStrategies,
  copycatProcessedVideos,
} from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { saveUpload } from './upload-service.js';
import { polishEditPrompt, analyzeVideoKeyframes } from './llm-service.js';
import { createJob, createFolder } from './job-service.js';
import { broadcast } from '../lib/sse.js';
import { crawlAllActiveBloggers, getYtDlpCookieArgs } from './tk-crawler.js';
import type { MediaInput } from '@bvp/shared';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateStrategyLog(strategyId: string, userId: string, logText: string) {
  db.update(copycatStrategies)
    .set({ lastRunLog: logText })
    .where(eq(copycatStrategies.id, strategyId))
    .run();
  broadcast({
    type: 'copycat_strategy.log_updated',
    userId,
    payload: { strategyId, logText },
    ts: Date.now(),
  });
}

/**
 * Extracts 3 keyframes evenly from a video file, uploads them, and returns their public URLs.
 */
export async function extractKeyframes(downloadUrl: string, duration: number, userId: string): Promise<string[]> {
  const tempDir = os.tmpdir();
  const sessionId = nanoid();
  const tempVideoPath = path.join(tempDir, `bvp-copycat-vid-${sessionId}.mp4`);
  const framePaths: string[] = [];
  const publicUrls: string[] = [];

  try {
    console.log(`[copycat-service] Downloading video for keyframe extraction: ${downloadUrl}`);
    const res = await request(downloadUrl);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Failed to download video: HTTP ${res.statusCode}`);
    }
    const buf = Buffer.from(await res.body.arrayBuffer());
    fs.writeFileSync(tempVideoPath, buf);

    // Calculate 3 timestamps (e.g. 10%, 50%, 90% of the video duration)
    const dur = duration > 0 ? duration : 10;
    const timestamps = [
      Math.max(0.1, dur * 0.1),
      dur * 0.5,
      dur * 0.9
    ];

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const framePath = path.join(tempDir, `bvp-copycat-frame-${sessionId}-${i}.jpg`);
      framePaths.push(framePath);

      console.log(`[copycat-service] Extracting keyframe at ${ts.toFixed(2)}s`);
      const cmd = `ffmpeg -y -ss ${ts} -i "${tempVideoPath}" -vframes 1 -f image2 -q:v 2 "${framePath}"`;
      execSync(cmd, { stdio: 'ignore' });

      if (fs.existsSync(framePath)) {
        const frameBuf = fs.readFileSync(framePath);
        const uploadRes = await saveUpload({
          userId,
          filename: `copycat_frame_${i}_${nanoid()}.jpg`,
          mime: 'image/jpeg',
          data: frameBuf,
        });
        publicUrls.push(uploadRes.publicUrl);
      }
    }
  } catch (err: any) {
    console.error(`[copycat-service] Keyframe extraction failed: ${err.message}`, err);
  } finally {
    // Clean up temp files
    try {
      if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
      for (const p of framePaths) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {}
  }

  return publicUrls;
}

/**
 * Process a single video for a specific Copycat Strategy.
 */
export async function processVideoForStrategy(
  strategy: typeof copycatStrategies.$inferSelect,
  video: typeof crawledVideos.$inferSelect,
  folderId: string | null = null
): Promise<string | null> {
  const userId = strategy.userId;
  console.log(`[copycat-service] Strategy ${strategy.id} (${strategy.name}) processing video ${video.uniqueId} ("${video.title}")`);

  try {
    let downloadUrl = video.downloadUrl;

    // On-demand download if it hasn't been downloaded and trimmed yet
    if (!downloadUrl || downloadUrl.trim() === '') {
      console.log(`[copycat-service] Video ${video.uniqueId} downloadUrl is empty. Downloading on-demand...`);
      
      const useMock = process.env.MOCK_CRAWLER === 'true';
      let videoBuffer: Buffer;

      if (useMock) {
        // Fetch a public stock MP4 for testing
        const sampleUrl = 'https://cdn.sprize.ai/proxy/15781/019e5e8e-f2ba-7a43-ae96-5ecb5b4404e7_0.mp4';
        const res = await request(sampleUrl);
        videoBuffer = Buffer.from(await res.body.arrayBuffer());
      } else {
        // Download using yt-dlp to a temp file, then read it into buffer
        const tempPath = path.join(os.tmpdir(), `bvp-dl-${nanoid()}.mp4`);
        const cookieArgs = getYtDlpCookieArgs();
        console.log(`[copycat-service] Downloading video via yt-dlp to: ${tempPath}`);
        const cmd = `yt-dlp ${cookieArgs} --no-part -o "${tempPath}" "${video.videoUrl}"`;
        await execPromise(cmd, { timeout: 45000 });
        if (!fs.existsSync(tempPath)) {
          throw new Error(`yt-dlp download failed, output file not found`);
        }
        videoBuffer = fs.readFileSync(tempPath);
        // Clean up temp file
        try {
          fs.unlinkSync(tempPath);
        } catch {}
      }

      // Save upload (this automatically trims it to 9.95s if it's >10s)
      const uploadRes = await saveUpload({
        userId,
        filename: `crawled_tk_${video.uniqueId}.mp4`,
        mime: 'video/mp4',
        data: videoBuffer,
      });

      downloadUrl = uploadRes.publicUrl;

      // Update crawled_videos db
      db.update(crawledVideos)
        .set({ downloadUrl })
        .where(eq(crawledVideos.id, video.id))
        .run();

      console.log(`[copycat-service] Video ${video.uniqueId} downloaded & trimmed successfully: ${downloadUrl}`);
    }

    let polishedPrompt = '';
    const seedValues: any[] = [];
    for (let s = 0; s < strategy.outputCount; s++) {
      const randomSeed = Math.floor(Math.random() * 2147483647);
      seedValues.push({
        label: `Seed ${randomSeed}`,
        paramOverrides: { 'parameters.seed': randomSeed }
      });
    }

    const batchMatrix = {
      axes: [
        {
          name: 'seed',
          values: seedValues
        }
      ]
    };

    if (strategy.type === 'video_edit') {
      // 1. Polish editing style prompt using Grok
      polishedPrompt = await polishEditPrompt({
        stylePrompt: strategy.stylePrompt,
        persona: strategy.persona,
      });

      console.log(`[copycat-service] Polished Edit Prompt: "${polishedPrompt}"`);

      const baseMedia: MediaInput[] = [
        {
          localId: 'source_video',
          kind: 'source_video',
          url: downloadUrl,
        },
        {
          localId: 'reference_image',
          kind: 'reference_image',
          url: strategy.refImageUrl,
        }
      ];

      // 2. Submit Wan 2.7 Video Edit job
      const job = createJob({
        userId,
        accountId: strategy.accountId,
        capabilityId: 'wan2.7.video_edit' as any,
        modelVariant: 'wan2.7-videoedit',
        basePrompt: polishedPrompt,
        baseNegativePrompt: '',
        baseMedia,
        baseParameters: {
          'parameters.duration': 0,
          ...(strategy.reuseAudio ? { 'extra.audioUrl': downloadUrl } : {}),
        },
        batchMatrix,
        folderId,
        jobIdPrefix: `同款策略-${strategy.name}`,
      });

      return job.jobId;

    } else if (strategy.type === 'r2v') {
      // 1. Extract 3 keyframes
      const keyframeUrls = await extractKeyframes(downloadUrl, video.durationSec, userId);
      if (keyframeUrls.length < 3) {
        throw new Error('Could not extract at least 3 keyframes from the video.');
      }

      // 2. Vision analysis using Grok
      const r2vPrompt = await analyzeVideoKeyframes({
        imageUrls: keyframeUrls,
        videoTitle: video.title || 'Untitled',
      });

      // Combine analyzed prompt with character base persona
      polishedPrompt = `${strategy.persona}, ${r2vPrompt}`;
      console.log(`[copycat-service] Generated R2V Combined Prompt: "${polishedPrompt}"`);

      const baseMedia: MediaInput[] = [
        {
          localId: 'image_ref',
          kind: 'reference_image',
          url: strategy.refImageUrl,
        }
      ];

      // 3. Submit Wan 2.7 R2V job
      const job = createJob({
        userId,
        accountId: strategy.accountId,
        capabilityId: 'wan2.7.r2v' as any,
        modelVariant: 'wan2.7-r2v',
        basePrompt: polishedPrompt,
        baseNegativePrompt: '',
        baseMedia,
        baseParameters: {
          'parameters.ratio': '9:16',
          'parameters.duration': 10,
          ...(strategy.reuseAudio ? { 'extra.audioUrl': downloadUrl } : {}),
        },
        batchMatrix,
        folderId,
        jobIdPrefix: `同款策略-${strategy.name}`,
      });

      return job.jobId;
    }
  } catch (err: any) {
    console.error(`[copycat-service] Error processing video ${video.uniqueId} for strategy ${strategy.id}: ${err.message}`, err);
  }

  return null;
}

export async function checkAndRunCopycatStrategies(
  userId: string,
  force = false,
  targetStrategyId?: string
): Promise<number> {
  const query = db
    .select()
    .from(copycatStrategies);

  const activeStrategies = targetStrategyId
    ? query.where(eq(copycatStrategies.id, targetStrategyId)).all()
    : query.where(and(eq(copycatStrategies.userId, userId), eq(copycatStrategies.status, 'active'))).all();

  console.log(`[copycat-service] Running copycat scheduler check for ${activeStrategies.length} strategies (force=${force}, target=${targetStrategyId || 'all'})`);
  let processedCount = 0;

  for (const strat of activeStrategies) {
    // Check if interval time has elapsed
    const now = Date.now();
    const intervalMs = strat.crawlIntervalHours * 3600 * 1000;
    if (!force && strat.lastExecutedAt && now - strat.lastExecutedAt < intervalMs) {
      console.log(`[copycat-service] Strategy ${strat.id} is cooling down, skipping.`);
      continue;
    }

    // Parse bloggers
    let bloggerIds: string[] = [];
    try {
      bloggerIds = JSON.parse(strat.bloggerIdsJson);
    } catch {
      continue;
    }

    if (bloggerIds.length === 0) continue;

    // 1. Log start
    updateStrategyLog(strat.id, userId, '正在运行策略');

    // Get all videos for these bloggers
    const query = db
      .select()
      .from(crawledVideos)
      .where(inArray(crawledVideos.bloggerId, bloggerIds));

    const allVideos = query.all();

    // Filter videos by strategy rules
    const filteredVideos = allVideos.filter((v) => {
      // 1. Duration check
      if (strat.filterMinDuration !== null && v.durationSec < strat.filterMinDuration) return false;
      if (strat.filterMaxDuration !== null && v.durationSec > strat.filterMaxDuration) return false;
      // 2. Publish date check
      if (strat.filterPublishAfter !== null && v.publishTime < strat.filterPublishAfter) return false;
      // 3. Play count check
      if (strat.filterMinPlayCount !== null && v.playCount < strat.filterMinPlayCount) return false;
      
      // 4. Deduplication check
      if (strat.filterDeduplicate === 1) {
        const processed = db
          .select()
          .from(copycatProcessedVideos)
          .where(
            and(
              eq(copycatProcessedVideos.strategyId, strat.id),
              eq(copycatProcessedVideos.videoUniqueId, v.uniqueId)
            )
          )
          .get();
        if (processed) return false;
      }
      return true;
    });

    console.log(`[copycat-service] Strategy ${strat.id} found ${filteredVideos.length} new matching videos to process`);

    const totalMatching = filteredVideos.length;
    // 2. Log detection count
    updateStrategyLog(strat.id, userId, `正在运行策略-检测到${totalMatching}条符合要求的原视频视频`);

    // Determine folder ID for this strategy execution
    let runFolderId: string | null = null;
    if (strat.autoCreateFolder === 1 && totalMatching > 0) {
      const runTimeStr = formatDate(now);
      const folderName = `${strat.name} ${runTimeStr}`;
      try {
        const folder = createFolder(userId, folderName);
        runFolderId = folder.id;
      } catch (err: any) {
        console.error(`[copycat-service] Failed to auto-create folder: ${err.message}`);
      }
    } else if (strat.destFolderId) {
      runFolderId = strat.destFolderId;
    }

    for (const [idx, vid] of filteredVideos.entries()) {
      // 3. Log creating progress
      updateStrategyLog(
        strat.id,
        userId,
        `正在运行策略-检测到${totalMatching}条符合要求的原视频视频-正在创建${idx + 1}/${totalMatching}条视频任务`
      );

      const jobId = await processVideoForStrategy(strat, vid, runFolderId);
      
      // Save processing record (using upsert to avoid UNIQUE constraint violation on re-runs)
      db.insert(copycatProcessedVideos)
        .values({
          strategyId: strat.id,
          videoUniqueId: vid.uniqueId,
          jobId,
          processedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [copycatProcessedVideos.strategyId, copycatProcessedVideos.videoUniqueId],
          set: {
            jobId,
            processedAt: Date.now(),
          },
        })
        .run();

      processedCount++;
    }

    // 4. Log completion
    updateStrategyLog(
      strat.id,
      userId,
      `正在运行策略-检测到${totalMatching}条符合要求的原视频视频-视频任务推送完毕-请检查任务详情`
    );

    // Update last executed time
    db.update(copycatStrategies)
      .set({ lastExecutedAt: Date.now() })
      .where(eq(copycatStrategies.id, strat.id))
      .run();
  }

  return processedCount;
}

import { users } from '../db/schema.js';

export function startCopycatDaemon() {
  console.log('[copycat-service] Copycat daemon daemon started');
  // Run every 30 minutes
  const run = async () => {
    try {
      const allUsers = db.select().from(users).all();
      for (const u of allUsers) {
        // Trigger crawling
        await crawlAllActiveBloggers(u.id);
        // Trigger copycat execution
        await checkAndRunCopycatStrategies(u.id);
      }
    } catch (err: any) {
      console.error('[copycat-service] Daemon execution failed:', err);
    }
  };

  // Run on start and schedule interval
  run();
  setInterval(run, 30 * 60 * 1000); 
}

