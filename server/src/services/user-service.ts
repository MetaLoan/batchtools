import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, jobs, subJobs, uploads, sessions } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { config } from '../config.js';

export interface UserSummary {
  id: string;
  username: string;
  isAdmin: boolean;
  displayName?: string;
  createdAt: number;
  lastLoginAt?: number;
}

export interface CreateUserInput {
  username: string;
  password: string;
  isAdmin?: boolean;
  displayName?: string;
}

function rowToSummary(r: typeof users.$inferSelect): UserSummary {
  return {
    id: r.id,
    username: r.username,
    isAdmin: !!r.isAdmin,
    displayName: r.displayName ?? undefined,
    createdAt: r.createdAt,
    lastLoginAt: r.lastLoginAt ?? undefined,
  };
}

const USERNAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{2,31}$/;

export function validateUsername(u: string): string | null {
  if (!u || !USERNAME_RE.test(u)) {
    return '用户名需 3-32 字符，仅含字母数字下划线、点、短横线';
  }
  return null;
}

export function validatePassword(p: string): string | null {
  if (!p || p.length < 6) return '密码至少 6 位';
  if (p.length > 128) return '密码过长';
  return null;
}

export function userCount(): number {
  const r = db.select().from(users).all();
  return r.length;
}

export function listUsers(): UserSummary[] {
  return db.select().from(users).all().map(rowToSummary);
}

export function getUserById(id: string): UserSummary | null {
  const r = db.select().from(users).where(eq(users.id, id)).get();
  return r ? rowToSummary(r) : null;
}

export function getUserByUsername(username: string): UserSummary | null {
  const r = db.select().from(users).where(eq(users.username, username)).get();
  return r ? rowToSummary(r) : null;
}

export function createUser(input: CreateUserInput): UserSummary {
  const u = validateUsername(input.username);
  if (u) throw new Error(u);
  const p = validatePassword(input.password);
  if (p) throw new Error(p);
  const existing = getUserByUsername(input.username);
  if (existing) throw new Error('用户名已存在');
  const id = nanoid();
  const now = Date.now();
  db.insert(users)
    .values({
      id,
      username: input.username,
      passwordHash: hashPassword(input.password),
      isAdmin: input.isAdmin ? 1 : 0,
      displayName: input.displayName,
      createdAt: now,
    })
    .run();
  return {
    id,
    username: input.username,
    isAdmin: !!input.isAdmin,
    displayName: input.displayName,
    createdAt: now,
  };
}

export function authenticate(username: string, password: string): UserSummary | null {
  const row = db.select().from(users).where(eq(users.username, username)).get();
  if (!row) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;
  db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, row.id)).run();
  return rowToSummary(row);
}

export function updateUserPassword(id: string, newPassword: string): void {
  const err = validatePassword(newPassword);
  if (err) throw new Error(err);
  db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, id)).run();
}

export function updateUser(
  id: string,
  patch: Partial<{ displayName: string; isAdmin: boolean }>
): UserSummary | null {
  const next: Partial<typeof users.$inferInsert> = {};
  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.isAdmin !== undefined) next.isAdmin = patch.isAdmin ? 1 : 0;
  if (Object.keys(next).length === 0) return getUserById(id);
  db.update(users).set(next).where(eq(users.id, id)).run();
  return getUserById(id);
}

export function deleteUser(id: string): boolean {
  // Remove on-disk upload files for this user
  const userUploadDir = path.join(config.dataDir, 'uploads', id);
  try {
    fs.rmSync(userUploadDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  // Accounts are centrally managed (devops/YAML) so they are NOT deleted with the user.
  db.transaction((tx) => {
    tx.delete(subJobs).where(eq(subJobs.userId, id)).run();
    tx.delete(jobs).where(eq(jobs.userId, id)).run();
    tx.delete(uploads).where(eq(uploads.userId, id)).run();
    tx.delete(sessions).where(eq(sessions.userId, id)).run();
    tx.delete(users).where(eq(users.id, id)).run();
  });
  return true;
}

export function adminCount(): number {
  const rows = db.select().from(users).where(eq(users.isAdmin, 1)).all();
  return rows.length;
}
