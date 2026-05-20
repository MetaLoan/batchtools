import { config } from './config.js';
import { createUser, userCount, validatePassword, validateUsername } from './services/user-service.js';

export function bootstrapInitialAdmin(log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (userCount() > 0) return;

  const username = config.initialAdminUsername;
  const password = config.initialAdminPassword;

  if (!password) {
    log.warn(
      '[bootstrap] No users exist and INITIAL_ADMIN_PASSWORD is not set. ' +
        'Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD in your .env, then restart.'
    );
    return;
  }

  const uErr = validateUsername(username);
  if (uErr) {
    log.warn(`[bootstrap] INITIAL_ADMIN_USERNAME invalid: ${uErr}`);
    return;
  }
  const pErr = validatePassword(password);
  if (pErr) {
    log.warn(`[bootstrap] INITIAL_ADMIN_PASSWORD invalid: ${pErr}`);
    return;
  }

  try {
    createUser({ username, password, isAdmin: true, displayName: 'Administrator' });
    log.info(`[bootstrap] Created initial admin user: ${username}`);
  } catch (e) {
    log.warn(`[bootstrap] Failed to create initial admin: ${(e as Error).message}`);
  }
}
