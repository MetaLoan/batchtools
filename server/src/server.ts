import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { config, isProd } from './config.js';
import { runMigrations } from './db/index.js';
import { registerAllProviders } from './providers/index.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { accountRoutes } from './routes/accounts.js';
import { capabilityRoutes } from './routes/capabilities.js';
import { jobRoutes } from './routes/jobs.js';
import { uploadRoutes } from './routes/uploads.js';
import { streamRoutes } from './routes/stream.js';
import { editorRoutes } from './routes/editor.js';
import { strategyRoutes } from './routes/strategies.js';
import { startScheduler } from './services/scheduler.js';
import { startPoller } from './services/poller.js';
import { startCleanup } from './services/cleanup.js';
import { rebuildConcurrencyFromDb } from './services/concurrency.js';
import { bootstrapInitialAdmin } from './bootstrap.js';
import { loadAccountsFromConfig } from './bootstrap-accounts.js';

async function main() {
  runMigrations();
  registerAllProviders();
  rebuildConcurrencyFromDb();

  const app = Fastify({ logger: { level: isProd ? 'info' : 'debug' } });

  const bootLog = {
    info: (m: string) => app.log.info(m),
    warn: (m: string) => app.log.warn(m),
  };
  bootstrapInitialAdmin(bootLog);
  loadAccountsFromConfig(bootLog);

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: config.uploadMaxBytes },
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(accountRoutes);
  await app.register(capabilityRoutes);
  await app.register(jobRoutes);
  await app.register(uploadRoutes);
  await app.register(streamRoutes);
  await app.register(editorRoutes);
  await app.register(strategyRoutes);

  app.get('/healthz', async () => ({ ok: true }));

  // Serve frontend in production
  if (isProd && fs.existsSync(config.webDistDir)) {
    await app.register(staticPlugin, {
      root: config.webDistDir,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/v1/') || req.url.startsWith('/uploads/') || req.url.startsWith('/healthz')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      reply.type('text/html').send(fs.readFileSync(path.join(config.webDistDir, 'index.html')));
    });
  }

  startScheduler();
  startPoller();
  startCleanup();

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
