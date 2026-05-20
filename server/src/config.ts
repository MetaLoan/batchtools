import 'dotenv/config';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(PROJECT_ROOT, 'data'),
  publicHost: process.env.PUBLIC_HOST ?? `http://localhost:${process.env.PORT ?? 3000}`,
  appPassword: process.env.APP_PASSWORD ?? 'changeme',
  masterKey: process.env.MASTER_KEY ?? 'dev-master-key-please-change',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024),
  uploadTtlHours: Number(process.env.UPLOAD_TTL_HOURS ?? 24),
  webDistDir: process.env.WEB_DIST_DIR ?? path.join(PROJECT_ROOT, 'web', 'dist'),
};

export const isProd = process.env.NODE_ENV === 'production';
