import { hmacSign } from '../lib/crypto.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { uploads } from '../db/schema.js';

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
        Body: input.data,
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
        bytes: input.data.length,
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
      bytes: input.data.length,
      filename: input.filename,
      mime: input.mime,
    };
  }

  // Local fallback
  const baseDir = UPLOAD_BASE();
  fs.mkdirSync(path.join(baseDir, input.userId), { recursive: true });
  const relPath = path.join(input.userId, `${id}${ext}`);
  const absPath = path.join(baseDir, relPath);
  fs.writeFileSync(absPath, input.data);

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
      bytes: input.data.length,
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
    bytes: input.data.length,
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
