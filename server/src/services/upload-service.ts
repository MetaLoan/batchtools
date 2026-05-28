import { hmacSign } from '../lib/crypto.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { uploads } from '../db/schema.js';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { request } from 'undici';

let s3Client: S3Client | null = null;
function getS3Client() {
  if (!s3Client && config.s3.accessKeyId && config.s3.bucket) {
    s3Client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey || '',
      },
    });
  }
  return s3Client;
}

const UPLOAD_BASE = () => path.join(config.dataDir, 'uploads');

export interface UploadInput {
  userId: string;
  filename: string;
  mime: string;
  data: Buffer;
}

export interface UploadResult {
  id: string;
  publicUrl: string;
  expiresAt: number;
  bytes: number;
  filename: string;
  mime: string;
}

function safeExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return ext || '.bin';
}

// Need fs and path imports for local fallback
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { and, eq, lt } from 'drizzle-orm';

export async function saveUpload(input: UploadInput): Promise<UploadResult> {
  if (input.data.length > config.uploadMaxBytes) {
    throw new Error(`File exceeds max size ${config.uploadMaxBytes} bytes`);
  }

  let mediaData = input.data;

  // 视频超限自动无损裁剪
  if (input.mime.startsWith('video/')) {
    const tempDir = os.tmpdir();
    const inputExt = path.extname(input.filename) || '.mp4';
    const tempInputPath = path.join(tempDir, `bvp-in-${nanoid()}${inputExt}`);
    const tempOutputPath = path.join(tempDir, `bvp-out-${nanoid()}${inputExt}`);

    try {
      fs.writeFileSync(tempInputPath, input.data);

      // 使用 ffprobe 获取时长
      const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempInputPath}"`;
      const durationStr = execSync(probeCmd, { encoding: 'utf8' }).trim();
      const duration = parseFloat(durationStr);

      if (!isNaN(duration) && duration > 10.0) {
        console.log(`[video-trim] Video ${input.filename} duration is ${duration}s (exceeds 10s). Trimming to 9.95s...`);
        // 使用 ffmpeg 执行重新编码裁剪（精确控制时长并保证解码兼容性，规避 AlgoError）
        const trimCmd = `ffmpeg -y -i "${tempInputPath}" -ss 0 -t 9.95 -c:v libx264 -preset superfast -crf 23 -c:a aac "${tempOutputPath}"`;
        execSync(trimCmd, { stdio: 'ignore' });

        if (fs.existsSync(tempOutputPath)) {
          mediaData = fs.readFileSync(tempOutputPath);
          console.log(`[video-trim] Successfully trimmed video. New size: ${mediaData.length} bytes.`);
        }
      }
    } catch (err) {
      console.error('[video-trim] Error during video duration check/trimming:', err);
    } finally {
      try {
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
      } catch {}
    }
  }

  const id = nanoid();
  const ext = safeExt(input.filename);
  const now = Date.now();

  const s3 = getS3Client();
  if (s3 && config.s3.bucket) {
    const s3Key = `uploads/${input.userId}/${id}${ext}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: s3Key,
        Body: mediaData,
        ContentType: input.mime,
      })
    );
    // Tigris public URL format: https://<bucket>.t3.tigrisfiles.io/<key>
    const publicUrl = `https://${config.s3.bucket}.t3.tigrisfiles.io/${s3Key}`;
    // Set 100 years expiration
    const expiresAt = now + 100 * 365 * 24 * 3600 * 1000;

    db.insert(uploads)
      .values({
        id,
        userId: input.userId,
        accountId: '',
        filename: input.filename,
        mime: input.mime,
        bytes: mediaData.length,
        storagePath: `s3://${config.s3.bucket}/${s3Key}`,
        signedKey: '',
        publicUrl,
        createdAt: now,
        expiresAt,
      })
      .run();

    return {
      id,
      publicUrl,
      expiresAt,
      bytes: mediaData.length,
      filename: input.filename,
      mime: input.mime,
    };
  }

  // Local fallback
  const baseDir = UPLOAD_BASE();
  fs.mkdirSync(path.join(baseDir, input.userId), { recursive: true });
  const relPath = path.join(input.userId, `${id}${ext}`);
  const absPath = path.join(baseDir, relPath);
  fs.writeFileSync(absPath, mediaData);

  const expiresAt = now + config.uploadTtlHours * 3600 * 1000;
  const signedPayload = `${input.userId}|${id}|${expiresAt}`;
  const signedKey = hmacSign(signedPayload);
  const publicUrl = `${config.publicHost}/uploads/${input.userId}/${id}${ext}?sig=${signedKey}&exp=${expiresAt}`;

  db.insert(uploads)
    .values({
      id,
      userId: input.userId,
      accountId: '',
      filename: input.filename,
      mime: input.mime,
      bytes: mediaData.length,
      storagePath: relPath,
      signedKey,
      publicUrl,
      createdAt: now,
      expiresAt,
    })
    .run();

  return {
    id,
    publicUrl,
    expiresAt,
    bytes: mediaData.length,
    filename: input.filename,
    mime: input.mime,
  };
}


export function verifySignedUpload(userId: string, id: string, sig: string, exp: number): boolean {
  if (exp < Date.now()) return false;
  const expected = hmacSign(`${userId}|${id}|${exp}`);
  if (expected.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return ok === 0;
}

export function getUploadStoragePath(userId: string, id: string): string | null {
  const r = db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
    .get();
  if (!r) return null;
  return path.join(UPLOAD_BASE(), r.storagePath);
}

export function getUploadDetails(
  userId: string,
  id: string
): { mime: string; bytes: number; storagePath: string } | null {
  const r = db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
    .get();
  if (!r) return null;
  return {
    mime: r.mime,
    bytes: r.bytes,
    storagePath: path.join(UPLOAD_BASE(), r.storagePath),
  };
}

export function listUserUploads(userId: string, limit = 50) {
  return db
    .select()
    .from(uploads)
    .where(eq(uploads.userId, userId))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      filename: r.filename,
      mime: r.mime,
      bytes: r.bytes,
      publicUrl: r.publicUrl,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
}

export function deleteExpiredUploads(): number {
  const now = Date.now();
  const expired = db.select().from(uploads).where(lt(uploads.expiresAt, now)).all();
  let count = 0;
  for (const u of expired) {
    try {
      if (!u.storagePath.startsWith('s3://')) {
        fs.unlinkSync(path.join(UPLOAD_BASE(), u.storagePath));
      }
    } catch {
      // ignore missing file
    }
    db.delete(uploads).where(eq(uploads.id, u.id)).run();
    count++;
  }
  return count;
}

export async function resolveUrlToStream(
  urlStr: string,
  userId: string
): Promise<{ stream: any; filename: string }> {
  try {
    const parsed = new URL(urlStr);
    const pathParts = parsed.pathname.split('/');
    // e.g. path is /uploads/:userId/:filename
    const uploadsIdx = pathParts.indexOf('uploads');
    if (uploadsIdx !== -1 && pathParts[uploadsIdx + 1] === userId) {
      const filename = pathParts[uploadsIdx + 2];
      const uploadId = filename.split('.')[0];
      const details = getUploadDetails(userId, uploadId);
      if (details && fs.existsSync(details.storagePath)) {
        return {
          stream: fs.createReadStream(details.storagePath),
          filename,
        };
      }
    }
  } catch (e) {
    // URL parse error or key mismatch, fallback to direct fetch
  }

  // Fallback to fetch
  const res = await request(urlStr, { method: 'GET' });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Failed to fetch remote asset from ${urlStr}: HTTP ${res.statusCode}`);
  }

  let filename = 'video.mp4';
  try {
    const parsed = new URL(urlStr);
    const base = path.basename(parsed.pathname);
    if (base && base.includes('.')) {
      filename = base;
    }
  } catch (e) {}

  return {
    stream: res.body,
    filename,
  };
}

