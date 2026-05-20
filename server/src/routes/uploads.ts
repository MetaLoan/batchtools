import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import {
  getUploadStoragePath,
  listAccountUploads,
  saveUpload,
  verifySignedUpload,
} from '../services/upload-service.js';

export async function uploadRoutes(app: FastifyInstance) {
  app.post(
    '/v1/uploads',
    { preHandler: requireAuth },
    async (req, reply) => {
      const accountId = (req.query as { accountId?: string }).accountId;
      if (!accountId) {
        reply.code(400).send({ error: 'accountId required' });
        return;
      }
      const file = await (req as unknown as { file: () => Promise<{ filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined> }).file();
      if (!file) {
        reply.code(400).send({ error: 'No file uploaded' });
        return;
      }
      const data = await file.toBuffer();
      try {
        const result = saveUpload({
          accountId,
          filename: file.filename,
          mime: file.mimetype,
          data,
        });
        reply.code(201).send(result);
      } catch (e: unknown) {
        reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  app.get(
    '/v1/uploads',
    { preHandler: requireAuth },
    async (req, reply) => {
      const accountId = (req.query as { accountId?: string }).accountId;
      if (!accountId) {
        reply.code(400).send({ error: 'accountId required' });
        return;
      }
      reply.send({ uploads: listAccountUploads(accountId) });
    }
  );

  // Public-but-signed file fetch endpoint that DashScope will hit
  app.get('/uploads/:accountId/:filename', async (req, reply) => {
    const { accountId, filename } = req.params as { accountId: string; filename: string };
    const { sig, exp } = req.query as { sig?: string; exp?: string };
    if (!sig || !exp) {
      reply.code(403).send({ error: 'Missing signature' });
      return;
    }
    const expNum = Number(exp);
    const id = filename.split('.')[0];
    if (!verifySignedUpload(accountId, id, sig, expNum)) {
      reply.code(403).send({ error: 'Invalid signature' });
      return;
    }
    const storagePath = getUploadStoragePath(accountId, id);
    if (!storagePath || !fs.existsSync(storagePath)) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    return reply.send(fs.createReadStream(storagePath));
  });
}
