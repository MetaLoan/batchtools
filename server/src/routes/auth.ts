import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionId,
  resolveSession,
  setSessionCookie,
  requireAuth,
} from '../lib/auth.js';
import { authenticate, updateUserPassword, getUserByUsername } from '../services/user-service.js';
import { verifyPassword } from '../lib/crypto.js';
import { db } from '../db/index.js';
import { users as usersTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1),
});

const ChangePasswordBody = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: '用户名或密码格式不正确' });
      return;
    }
    const user = authenticate(parsed.data.username, parsed.data.password);
    if (!user) {
      reply.code(401).send({ error: '用户名或密码错误' });
      return;
    }
    const session = createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    reply.send({ ok: true, user });
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    destroySession(getSessionId(req));
    clearSessionCookie(reply);
    reply.send({ ok: true });
  });

  app.get('/v1/auth/me', async (req, reply) => {
    const user = resolveSession(getSessionId(req));
    if (!user) {
      reply.send({ authenticated: false });
      return;
    }
    reply.send({ authenticated: true, user });
  });

  app.post(
    '/v1/auth/change-password',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = ChangePasswordBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ error: parsed.error.flatten() });
        return;
      }
      const me = req.currentUser!;
      const row = db.select().from(usersTable).where(eq(usersTable.id, me.id)).get();
      if (!row || !verifyPassword(parsed.data.oldPassword, row.passwordHash)) {
        reply.code(401).send({ error: '原密码错误' });
        return;
      }
      try {
        updateUserPassword(me.id, parsed.data.newPassword);
        reply.send({ ok: true });
      } catch (e) {
        reply.code(400).send({ error: (e as Error).message });
      }
    }
  );
}
