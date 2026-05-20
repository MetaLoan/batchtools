import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { registerSseClient } from '../lib/sse.js';

export async function streamRoutes(app: FastifyInstance) {
  // Stream is scoped to the current user (not per-account, since accounts are now shared)
  app.get('/v1/stream/me', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.currentUser!.id;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: ready\ndata: {"userId":"${userId}"}\n\n`);
    registerSseClient(userId, reply);
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);
    reply.raw.on('close', () => clearInterval(heartbeat));
  });
}
