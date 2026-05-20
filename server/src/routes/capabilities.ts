import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { listCapabilities } from '../providers/index.js';

export async function capabilityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.get('/v1/capabilities', async () => {
    return { capabilities: listCapabilities() };
  });
}
