import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  createAccount,
  deleteAccountForUser,
  getAccountForUser,
  listAccountsForUser,
  updateAccountForUser,
} from '../services/account-service.js';

const CreateAccountBody = z.object({
  name: z.string().min(1).max(64),
  apiKey: z.string().min(1),
  endpoint: z.string().url().optional(),
  disableDataInspection: z.boolean().optional(),
  policy: z
    .object({
      maxConcurrentRunning: z.number().int().positive().optional(),
      submitRatePerMin: z.number().int().positive().optional(),
      fairShareWeight: z.number().positive().optional(),
    })
    .partial()
    .optional(),
});

const UpdateAccountBody = CreateAccountBody.partial();

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/accounts', async (req) => {
    return { accounts: listAccountsForUser(req.currentUser!.id) };
  });

  app.post('/v1/accounts', async (req, reply) => {
    const parsed = CreateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    const acc = createAccount({ ...parsed.data, userId: req.currentUser!.id });
    reply.code(201).send(acc);
  });

  app.patch('/v1/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.flatten() });
      return;
    }
    const acc = updateAccountForUser(req.currentUser!.id, id, parsed.data);
    if (!acc) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.send(acc);
  });

  app.delete('/v1/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteAccountForUser(req.currentUser!.id, id);
    if (!ok) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.send({ ok: true });
  });

  app.get('/v1/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const acc = getAccountForUser(req.currentUser!.id, id);
    if (!acc) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.send(acc);
  });
}
