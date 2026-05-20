import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  checkPassword,
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionId,
  setSessionCookie,
  validateSession,
} from '../lib/auth.js';

const LoginBody = z.object({ password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'Bad request' });
      return;
    }
    if (!checkPassword(parsed.data.password)) {
      reply.code(401).send({ error: 'Invalid password' });
      return;
    }
    const session = createSession();
    setSessionCookie(reply, session.id, session.expiresAt);
    reply.send({ ok: true });
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const sid = getSessionId(req);
    destroySession(sid);
    clearSessionCookie(reply);
    reply.send({ ok: true });
  });

  app.get('/v1/auth/me', async (req, reply) => {
    const sid = getSessionId(req);
    const ok = validateSession(sid);
    reply.send({ authenticated: ok });
  });
}
