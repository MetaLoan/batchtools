import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { renderVideo, type RenderParams } from '../services/editor-service.js';

export async function editorRoutes(app: FastifyInstance) {
  app.post('/v1/editor/render', { preHandler: requireAuth }, async (req, reply) => {
    const params = req.body as RenderParams;

    if (!params.segments || params.segments.length === 0) {
      reply.code(400).send({ error: 'Segments list is required' });
      return;
    }

    try {
      const logger = {
        info: (m: string) => app.log.info(m),
        debug: (m: string) => app.log.debug(m),
        warn: (m: string) => app.log.warn(m),
        error: (m: string) => app.log.error(m),
      };

      const publicUrl = await renderVideo(params, req.currentUser!.id, logger);
      reply.code(200).send({ trimmedUrl: publicUrl });
    } catch (err: any) {
      reply.code(500).send({ error: err.message || 'Video rendering failed' });
    }
  });
}
