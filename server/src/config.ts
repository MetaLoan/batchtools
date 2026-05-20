import path from 'node:path';
import dotenv from 'dotenv';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

// Load .env from project root regardless of cwd
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
// Also load server/.env as a fallback (for deployment overrides)
dotenv.config({ path: path.join(PROJECT_ROOT, 'server', '.env'), override: false });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(PROJECT_ROOT, 'data'),
  publicHost: process.env.PUBLIC_HOST ?? `http://localhost:${process.env.PORT ?? 3000}`,
  masterKey: process.env.MASTER_KEY ?? 'dev-master-key-please-change',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024),
  uploadTtlHours: Number(process.env.UPLOAD_TTL_HOURS ?? 24),
  webDistDir: process.env.WEB_DIST_DIR ?? path.join(PROJECT_ROOT, 'web', 'dist'),
  // Bootstrap initial admin on first start (only used when no users exist yet)
  initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME ?? 'admin',
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD ?? '',
};

export const isProd = process.env.NODE_ENV === 'production';
