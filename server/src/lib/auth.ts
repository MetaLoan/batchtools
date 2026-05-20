import type { FastifyRequest, FastifyReply } from 'fastify';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { config } from '../config.js';
import { timingSafeEqual } from './crypto.js';

const SESSION_COOKIE = 'bvp_session';

export function checkPassword(input: string): boolean {
  if (!input || !config.appPassword) return false;
  if (input.length !== config.appPassword.length) return false;
  return timingSafeEqual(input, config.appPassword);
}

export function createSession(): { id: string; expiresAt: number } {
  const id = nanoid(32);
  const now = Date.now();
  const expiresAt = now + config.sessionTtlDays * 24 * 60 * 60 * 1000;
  db.insert(sessions).values({ id, createdAt: now, expiresAt }).run();
  return { id, expiresAt };
}

export function validateSession(id: string | undefined): boolean {
  if (!id) return false;
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) return false;
  if (row.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return false;
  }
  return true;
}

export function destroySession(id: string | undefined) {
  if (!id) return;
  db.delete(sessions).where(eq(sessions.id, id)).run();
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

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sid = getSessionId(req);
  if (!validateSession(sid)) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
