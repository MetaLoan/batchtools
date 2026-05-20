import type { FastifyRequest, FastifyReply } from 'fastify';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { config } from '../config.js';
import { getUserById, type UserSummary } from '../services/user-service.js';

const SESSION_COOKIE = 'bvp_session';

export function createSession(userId: string): { id: string; expiresAt: number } {
  const id = nanoid(32);
  const now = Date.now();
  const expiresAt = now + config.sessionTtlDays * 24 * 60 * 60 * 1000;
  db.insert(sessions).values({ id, userId, createdAt: now, expiresAt }).run();
  return { id, expiresAt };
}

export function resolveSession(sid: string | undefined): UserSummary | null {
  if (!sid) return null;
  const row = db.select().from(sessions).where(eq(sessions.id, sid)).get();
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, sid)).run();
    return null;
  }
  const user = getUserById(row.userId);
  if (!user) {
    // user was deleted — orphan session
    db.delete(sessions).where(eq(sessions.id, sid)).run();
    return null;
  }
  return user;
}

export function destroySession(id: string | undefined) {
  if (!id) return;
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function destroyAllUserSessions(userId: string) {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function setSessionCookie(reply: FastifyReply, id: string, expiresAt: number) {
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSessionId(req: FastifyRequest): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: UserSummary;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sid = getSessionId(req);
  const user = resolveSession(sid);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  req.currentUser = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.currentUser?.isAdmin) {
    reply.code(403).send({ error: 'Forbidden — admin only' });
  }
}
