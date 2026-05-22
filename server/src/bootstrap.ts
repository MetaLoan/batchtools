import { config } from './config.js';
import { createUser, userCount, validatePassword, validateUsername, getUserByUsername } from './services/user-service.js';

export function bootstrapInitialAdmin(log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (userCount() === 0) {
    const username = config.initialAdminUsername;
    const password = config.initialAdminPassword;

    if (!password) {
      log.warn(
        '[bootstrap] No users exist and INITIAL_ADMIN_PASSWORD is not set. ' +
          'Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD in your .env, then restart.'
      );
    } else {
      const uErr = validateUsername(username);
      const pErr = validatePassword(password);
      if (uErr) {
        log.warn(`[bootstrap] INITIAL_ADMIN_USERNAME invalid: ${uErr}`);
      } else if (pErr) {
        log.warn(`[bootstrap] INITIAL_ADMIN_PASSWORD invalid: ${pErr}`);
      } else {
        try {
          createUser({ username, password, isAdmin: true, displayName: 'Administrator' });
          log.info(`[bootstrap] Created initial admin user: ${username}`);
        } catch (e) {
          log.warn(`[bootstrap] Failed to create initial admin: ${(e as Error).message}`);
        }
      }
    }
  }

  try {
    const existingLeo = getUserByUsername('leo');
    if (!existingLeo) {
      createUser({ username: 'leo', password: 'admin123456', isAdmin: true, displayName: 'Leo Admin' });
      log.info('[bootstrap] Created admin user: leo');
    }
  } catch (e) {
    log.warn(`[bootstrap] Failed to create admin user leo: ${(e as Error).message}`);
  }
}
