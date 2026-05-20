import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { eq, notInArray } from 'drizzle-orm';
import { db } from './db/index.js';
import { accounts as accountsTable } from './db/schema.js';
import { config } from './config.js';
import { encryptSecret } from './lib/crypto.js';
import { nanoid } from 'nanoid';
import { DASHSCOPE_DEFAULT_ENDPOINT, DEFAULT_ACCOUNT_POLICY } from '@bvp/shared';

interface AccountConfigEntry {
  name: string;
  apiKey: string;
  endpoint?: string;
  queryEndpoint?: string;
  disableDataInspection?: boolean;
  policy?: Partial<typeof DEFAULT_ACCOUNT_POLICY>;
}

interface AccountsConfig {
  accounts?: AccountConfigEntry[];
}

export function loadAccountsFromConfig(log: {
  info: (m: string) => void;
  warn: (m: string) => void;
}) {
  let raw: string | null = null;
  let source: string;

  // Priority 1: env var (used by fly.io secret injection)
  const envYaml = process.env.DASHSCOPE_ACCOUNTS_YAML;
  if (envYaml && envYaml.trim().length > 0) {
    raw = envYaml;
    source = 'env DASHSCOPE_ACCOUNTS_YAML';
  } else {
    // Priority 2: YAML file on disk (local dev)
    const file = config.accountsConfigFile;
    if (!fs.existsSync(file)) {
      log.warn(
        `[accounts] No accounts config found at ${file} and DASHSCOPE_ACCOUNTS_YAML env var not set. ` +
          'Create accounts.yaml or set the env var to enable DashScope calls.'
      );
      return;
    }
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      log.warn(`[accounts] Failed to read ${file}: ${(e as Error).message}`);
      return;
    }
    source = file;
  }

  let parsed: AccountsConfig;
  try {
    parsed = parseYaml(raw) ?? {};
  } catch (e) {
    log.warn(`[accounts] Failed to parse YAML from ${source}: ${(e as Error).message}`);
    return;
  }

  const entries = parsed.accounts ?? [];
  if (!Array.isArray(entries)) {
    log.warn(`[accounts] Expected "accounts" to be an array in ${source}`);
    return;
  }

  const namesInConfig = new Set<string>();
  let upserted = 0;

  for (const entry of entries) {
    if (!entry?.name || !entry?.apiKey) {
      log.warn(`[accounts] Skipping invalid entry (missing name or apiKey)`);
      continue;
    }
    const name = entry.name.trim();
    const apiKey = entry.apiKey.trim();
    if (!name || !apiKey) continue;
    namesInConfig.add(name);

    const policy = { ...DEFAULT_ACCOUNT_POLICY, ...(entry.policy ?? {}) };
    const endpoint = entry.endpoint?.trim() || DASHSCOPE_DEFAULT_ENDPOINT;
    const queryEndpoint = entry.queryEndpoint?.trim() || null;
    const disableDI = entry.disableDataInspection ? 1 : 0;

    const existing = db.select().from(accountsTable).where(eq(accountsTable.name, name)).get();
    if (existing) {
      db.update(accountsTable)
        .set({
          apiKeyEncrypted: encryptSecret(apiKey),
          endpoint,
          queryEndpoint,
          disableDataInspection: disableDI,
          policyJson: JSON.stringify(policy),
        })
        .where(eq(accountsTable.id, existing.id))
        .run();
    } else {
      db.insert(accountsTable)
        .values({
          id: nanoid(),
          userId: 'system',
          name,
          apiKeyEncrypted: encryptSecret(apiKey),
          endpoint,
          queryEndpoint,
          disableDataInspection: disableDI,
          policyJson: JSON.stringify(policy),
          createdAt: Date.now(),
        })
        .run();
    }
    upserted++;
  }

  // Remove accounts that are no longer in the YAML config so the file remains the source of truth.
  const names = Array.from(namesInConfig);
  if (names.length === 0) {
    db.delete(accountsTable).run();
  } else {
    db.delete(accountsTable).where(notInArray(accountsTable.name, names)).run();
  }

  log.info(`[accounts] Synced ${upserted} account(s) from ${source}`);
}
