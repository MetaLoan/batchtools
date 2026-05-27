import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
const execPromise = promisify(exec);
import { nanoid } from 'nanoid';
import { request } from 'undici';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { tkBloggers, crawledVideos, copycatStrategies, uploads } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { saveUpload } from './upload-service.js';

export interface CrawledVideoInfo {
  uniqueId: string;
  title: string;
  videoUrl: string;
  durationSec: number;
  publishTime: number;
  playCount: number;
  downloadUrl?: string;
  coverUrl?: string;
}

// Check if yt-dlp is available in the path
function isYtDlpAvailable(): boolean {
  try {
    execSync('which yt-dlp', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Crawl the latest videos for a specific blogger.
 * Attempts to use yt-dlp if available, otherwise falls back to simulating a crawl (Mock mode).
 */
export async function crawlBloggerVideos(bloggerId: string, userId: string): Promise<CrawledVideoInfo[]> {
  const blogger = db.select().from(tkBloggers).where(eq(tkBloggers.id, bloggerId)).get();
  if (!blogger) {
    throw new Error(`Blogger not found: ${bloggerId}`);
  }

  console.log(`[tk-crawler] Starting crawl for blogger: ${blogger.handle} (${blogger.homepageUrl})`);

  let fetchedVideos: CrawledVideoInfo[] = [];
  let nickname = blogger.nickname || '';
  let avatarUrl = blogger.avatarUrl || '';
  let signature = blogger.signature || '';
  let crawlError = '';

  const useMock = process.env.MOCK_CRAWLER === 'true' || !isYtDlpAvailable();

  if (useMock) {
    console.log(`[tk-crawler] Using mock crawler for ${blogger.handle}`);
    fetchedVideos = generateMockVideos(blogger.handle);
    nickname = blogger.handle.slice(1) + ' (Mock)';
    avatarUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop';
    signature = 'This is a simulated TikTok influencer account description.';
  } else {
    try {
      const res = await runYtDlpCrawler(blogger.homepageUrl);
      fetchedVideos = res.videos;
      if (res.nickname) nickname = res.nickname;
      if (res.avatarUrl) avatarUrl = res.avatarUrl;
      if (res.signature) signature = res.signature;
    } catch (err: any) {
      console.warn(`[tk-crawler] yt-dlp crawl failed for ${blogger.handle}: ${err.message}. Falling back to mock.`, err);
      fetchedVideos = generateMockVideos(blogger.handle);
      nickname = blogger.handle.slice(1) + ' (Mock Fallback)';
      avatarUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop';
      signature = 'Fallback simulated description.';
      
      const errMsg = err.message || '';
      if (errMsg.includes('confirm your age') || errMsg.includes('inappropriate') || errMsg.includes('uncomfortable') || errMsg.includes('Sign in') || errMsg.includes('login') || errMsg.includes('Login')) {
        crawlError = 'TikTok 提示登录以确认年龄，请在本地后端 .env 中配置 Cookie 关联浏览器';
      } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timed out')) {
        crawlError = '网络连接超时，可能需要配置海外代理访问 TikTok';
      } else {
        crawlError = `采集出错: ${errMsg.slice(0, 80)}`;
      }
    }
  }

  const savedVideos: CrawledVideoInfo[] = [];

  // Filter and save new videos
  for (const info of fetchedVideos) {
    const existing = db
      .select()
      .from(crawledVideos)
      .where(and(eq(crawledVideos.bloggerId, bloggerId), eq(crawledVideos.uniqueId, info.uniqueId)))
      .get();

    if (existing) {
      console.log(`[tk-crawler] Video ${info.uniqueId} already crawled, skipping.`);
      continue;
    }

    try {
      // Save metadata directly to crawled_videos db (deferred download)
      const videoDbId = nanoid();
      db.insert(crawledVideos)
        .values({
          id: videoDbId,
          bloggerId,
          uniqueId: info.uniqueId,
          title: info.title,
          videoUrl: info.videoUrl,
          downloadUrl: '', // empty by default, downloaded on-demand when strategy runs
          coverUrl: info.coverUrl || '',
          durationSec: info.durationSec, // original duration
          publishTime: info.publishTime,
          playCount: info.playCount,
          createdAt: Date.now(),
        })
        .run();

      savedVideos.push({
        ...info,
        downloadUrl: '',
      });
      console.log(`[tk-crawler] Saved metadata for video: ${info.title} (${info.uniqueId})`);
    } catch (err: any) {
      console.error(`[tk-crawler] Failed to save video metadata ${info.uniqueId}: ${err.message}`, err);
    }
  }

  // Update last crawled timestamp, profile information, and error status
  db.update(tkBloggers)
    .set({
      lastCrawledAt: Date.now(),
      nickname,
      avatarUrl,
      signature,
      crawlError: crawlError || null,
    })
    .where(eq(tkBloggers.id, bloggerId))
    .run();

  return savedVideos;
}

/**
 * Trigger crawl for all active bloggers for a user.
 */
export async function crawlAllActiveBloggers(userId: string): Promise<number> {
  const bloggers = db
    .select()
    .from(tkBloggers)
    .where(and(eq(tkBloggers.userId, userId), eq(tkBloggers.status, 'active')))
    .all();

  console.log(`[tk-crawler] Periodic crawl triggered for ${bloggers.length} bloggers`);
  let count = 0;
  for (const b of bloggers) {
    try {
      const news = await crawlBloggerVideos(b.id, userId);
      count += news.length;
    } catch (err: any) {
      console.error(`[tk-crawler] Failed crawling blogger ${b.handle}: ${err.message}`);
    }
  }
  return count;
}

export function getYtDlpCookieArgs(): string {
  const browser = process.env.TIKTOK_COOKIES_FROM_BROWSER;
  const file = process.env.TIKTOK_COOKIES_FILE;
  if (browser) {
    return `--cookies-from-browser ${browser}`;
  }
  if (file) {
    return `--cookies "${file}"`;
  }
  // Fallback to default cookies.txt in config.dataDir
  const defaultCookiesPath = path.join(config.dataDir, 'cookies.txt');
  if (fs.existsSync(defaultCookiesPath)) {
    return `--cookies "${defaultCookiesPath}"`;
  }
  return '';
}

/**
 * Runs a real yt-dlp metadata scrape.
 */
interface CrawlResult {
  nickname?: string;
  avatarUrl?: string;
  signature?: string;
  videos: CrawledVideoInfo[];
}

async function runYtDlpCrawler(homepageUrl: string): Promise<CrawlResult> {
  // Call yt-dlp to dump flat playlist metadata in JSON
  const cookieArgs = getYtDlpCookieArgs();
  const cmd = `yt-dlp ${cookieArgs} --flat-playlist --playlist-end 10 -J "${homepageUrl}"`;
  const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 });
  const data = JSON.parse(stdout);

  // Extract blogger profile info
  const nickname = data.uploader || data.title || '';
  const signature = data.description || '';
  const avatarUrl = data.thumbnails?.[data.thumbnails.length - 1]?.url || data.thumbnails?.[0]?.url || data.thumbnail || '';

  const entries = data.entries || [];
  const infos: CrawledVideoInfo[] = [];

  for (const entry of entries) {
    if (!entry.id) continue;
    
    // Direct download URL is empty by default and resolved on-demand when strategy runs
    const directUrl = '';
    const coverUrl = entry.thumbnails?.[0]?.url || entry.thumbnail || '';

    infos.push({
      uniqueId: entry.id,
      title: entry.title || 'Untitled Video',
      videoUrl: entry.url || `https://www.tiktok.com/video/${entry.id}`,
      durationSec: entry.duration || 15,
      publishTime: entry.timestamp ? entry.timestamp * 1000 : Date.now(),
      playCount: entry.view_count || 1000,
      downloadUrl: directUrl,
      coverUrl,
    });
  }

  return {
    nickname,
    avatarUrl,
    signature,
    videos: infos,
  };
}

/**
 * Simulates a crawl list for debugging/testing.
 */
function generateMockVideos(handle: string): CrawledVideoInfo[] {
  const randomCount = 4 + Math.floor(Math.random() * 3);
  const infos: CrawledVideoInfo[] = [];
  const cleanHandle = handle.replace(/^@/, '');
  const sampleCovers = [
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=400&fit=crop',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=400&fit=crop',
  ];

  for (let i = 0; i < randomCount; i++) {
    const videoId = `${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const titles = [
      `Casual Vlog Day ${Math.floor(Math.random() * 100)} - relaxing in the sun!`,
      `Elevator outfit check #OOTD`,
      `Late night stroll down the neon street`,
      `Baking cookies in a messy kitchen`,
    ];
    infos.push({
      uniqueId: videoId,
      title: titles[i % titles.length],
      videoUrl: `https://www.tiktok.com/@${cleanHandle}/video/${videoId}`,
      durationSec: 12 + Math.floor(Math.random() * 30), // 12s - 42s
      publishTime: Date.now() - i * 4 * 3600 * 1000, // spaced out
      playCount: 1500 + Math.floor(Math.random() * 120000),
      coverUrl: sampleCovers[i % sampleCovers.length],
    });
  }
  return infos;
}
