import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { registerSseClient } from '../lib/sse.js';

export async function streamRoutes(app: FastifyInstance) {
  app.get('/v1/stream/:accountId', { preHandler: requireAuth }, async (req, reply) => {
    const { accountId } = req.params as { accountId: string };
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: ready\ndata: {"accountId":"${accountId}"}\n\n`);
    registerSseClient(accountId, reply);
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
