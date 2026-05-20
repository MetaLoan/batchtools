import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import {
  listAllAccounts,
  getAccountById,
  testAccountConnection,
} from '../services/account-service.js';

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Listing is visible to all authed users — no API keys are exposed
  app.get('/v1/accounts', async () => {
    return { accounts: listAllAccounts() };
  });

  app.get('/v1/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const acc = getAccountById(id);
    if (!acc) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.send(acc);
  });

  // Diagnostic — any authed user can probe connectivity for an account they intend to use
  app.post('/v1/accounts/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await testAccountConnection(id);
    reply.send(result);
  });
}
