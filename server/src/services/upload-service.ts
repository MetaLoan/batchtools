import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { uploads } from '../db/schema.js';
import { config } from '../config.js';
import { hmacSign } from '../lib/crypto.js';

const UPLOAD_BASE = () => path.join(config.dataDir, 'uploads');

export interface UploadInput {
  accountId: string;
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

export function saveUpload(input: UploadInput): UploadResult {
  if (input.data.length > config.uploadMaxBytes) {
    throw new Error(`File exceeds max size ${config.uploadMaxBytes} bytes`);
  }
  const id = nanoid();
  const ext = safeExt(input.filename);
  const baseDir = UPLOAD_BASE();
  fs.mkdirSync(path.join(baseDir, input.accountId), { recursive: true });
  const relPath = path.join(input.accountId, `${id}${ext}`);
  const absPath = path.join(baseDir, relPath);
  fs.writeFileSync(absPath, input.data);

  const now = Date.now();
  const expiresAt = now + config.uploadTtlHours * 3600 * 1000;
  const signedPayload = `${input.accountId}|${id}|${expiresAt}`;
  const signedKey = hmacSign(signedPayload);
  const publicUrl = `${config.publicHost}/uploads/${input.accountId}/${id}${ext}?sig=${signedKey}&exp=${expiresAt}`;

  db.insert(uploads)
    .values({
      id,
      accountId: input.accountId,
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

export function verifySignedUpload(accountId: string, id: string, sig: string, exp: number): boolean {
  if (exp < Date.now()) return false;
  const expected = hmacSign(`${accountId}|${id}|${exp}`);
  if (expected.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return ok === 0;
}

export function getUploadStoragePath(accountId: string, id: string): string | null {
  const r = db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.accountId, accountId)))
    .get();
  if (!r) return null;
  return path.join(UPLOAD_BASE(), r.storagePath);
}

export function listAccountUploads(accountId: string, limit = 50) {
  return db
    .select()
    .from(uploads)
    .where(eq(uploads.accountId, accountId))
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
      fs.unlinkSync(path.join(UPLOAD_BASE(), u.storagePath));
    } catch {
      // ignore missing file
    }
    db.delete(uploads).where(eq(uploads.id, u.id)).run();
    count++;
  }
  return count;
}
