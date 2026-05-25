import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import {
  getUploadDetails,
  listUserUploads,
  saveUpload,
  verifySignedUpload,
} from '../services/upload-service.js';

export async function uploadRoutes(app: FastifyInstance) {
  app.post('/v1/uploads', { preHandler: requireAuth }, async (req, reply) => {
    const file = await (req as unknown as {
      file: () => Promise<
        { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
      >;
    }).file();
    if (!file) {
      reply.code(400).send({ error: 'No file uploaded' });
      return;
    }
    const data = await file.toBuffer();
    try {
      const result = await saveUpload({
        userId: req.currentUser!.id,
        filename: file.filename,
        mime: file.mimetype,
        data,
      });
      reply.code(201).send(result);
    } catch (e: unknown) {
      reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/v1/uploads', { preHandler: requireAuth }, async (req, reply) => {
    reply.send({ uploads: listUserUploads(req.currentUser!.id) });
  });

  // Public-but-signed file fetch endpoint that DashScope will hit
  app.get('/uploads/:userId/:filename', async (req, reply) => {
    const { userId, filename } = req.params as { userId: string; filename: string };
    const { sig, exp } = req.query as { sig?: string; exp?: string };
    if (!sig || !exp) {
      reply.code(403).send({ error: 'Missing signature' });
      return;
    }
    const expNum = Number(exp);
    const id = filename.split('.')[0];
    if (!verifySignedUpload(userId, id, sig, expNum)) {
      reply.code(403).send({ error: 'Invalid signature' });
      return;
    }
        const upload = getUploadDetails(userId, id);
    if (!upload || !fs.existsSync(upload.storagePath)) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.header('Content-Type', upload.mime);
    reply.header('Content-Length', upload.bytes);
    return reply.send(fs.createReadStream(upload.storagePath));
  });
}
