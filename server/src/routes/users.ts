import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  updateUserPassword,
  adminCount,
  getUserById,
} from '../services/user-service.js';

const CreateUserBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6).max(128),
  displayName: z.string().max(64).optional(),
  isAdmin: z.boolean().optional(),
});

const UpdateUserBody = z.object({
  displayName: z.string().max(64).optional(),
  isAdmin: z.boolean().optional(),
});

const ResetPasswordBody = z.object({
  newPassword: z.string().min(6).max(128),
});

export async function userRoutes(app: FastifyInstance) {
  // GET listing: any authed user can see the list (for display names, etc.).
  // Mutations require admin.
  app.get('/v1/users', { preHandler: requireAuth }, async () => {
    return { users: listUsers() };
  });

  app.post('/v1/users', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    try {
      const u = createUser(parsed.data);
      reply.code(201).send(u);
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.patch('/v1/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    // Prevent demoting the last admin
    if (parsed.data.isAdmin === false) {
      const target = getUserById(id);
      if (target?.isAdmin && adminCount() <= 1) {
        reply.code(400).send({ error: '至少要保留一个管理员' });
        return;
      }
    }
    const u = updateUser(id, parsed.data);
    if (!u) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.send(u);
  });

  app.post('/v1/users/:id/reset-password', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ResetPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    if (!getUserById(id)) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    try {
      updateUserPassword(id, parsed.data.newPassword);
      reply.send({ ok: true });
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete('/v1/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (req.currentUser?.id === id) {
      reply.code(400).send({ error: '不能删除自己' });
      return;
    }
    const target = getUserById(id);
    if (!target) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    if (target.isAdmin && adminCount() <= 1) {
      reply.code(400).send({ error: '至少要保留一个管理员' });
      return;
    }
    deleteUser(id);
    reply.send({ ok: true });
  });
}
