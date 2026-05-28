import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'app.db');

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite, { schema });

export function runMigrations() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT 'https://dashscope-intl.aliyuncs.com',
      query_endpoint TEXT,
      disable_data_inspection INTEGER NOT NULL DEFAULT 0,
      policy_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts(user_id);

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      signed_key TEXT NOT NULL,
      public_url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_sec REAL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS uploads_user_idx ON uploads(user_id);
    CREATE INDEX IF NOT EXISTS uploads_account_idx ON uploads(account_id);
    CREATE INDEX IF NOT EXISTS uploads_expires_idx ON uploads(expires_at);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      model_variant TEXT NOT NULL,
      base_prompt TEXT,
      base_negative_prompt TEXT,
      base_media_json TEXT NOT NULL DEFAULT '[]',
      base_parameters_json TEXT NOT NULL DEFAULT '{}',
      batch_matrix_json TEXT NOT NULL DEFAULT '{"axes":[]}',
      total_sub_jobs INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS jobs_user_status_idx ON jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS jobs_account_status_idx ON jobs(account_id, status);
    CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at);

    CREATE TABLE IF NOT EXISTS sub_jobs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      index_in_job INTEGER NOT NULL,
      axes_json TEXT NOT NULL DEFAULT '{}',
      params_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_task_id TEXT,
      is_synthetic INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error_json TEXT,
      result_urls_json TEXT,
      orig_prompt TEXT,
      actual_prompt TEXT,
      poll_next_at INTEGER,
      poll_state_json TEXT,
      submitted_at INTEGER,
      finished_at INTEGER,
      origin_sub_job_id TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS sub_jobs_job_idx ON sub_jobs(job_id);
    CREATE INDEX IF NOT EXISTS sub_jobs_user_status_idx ON sub_jobs(user_id, status);
    CREATE INDEX IF NOT EXISTS sub_jobs_account_status_idx ON sub_jobs(account_id, status);
    CREATE INDEX IF NOT EXISTS sub_jobs_status_poll_idx ON sub_jobs(status, poll_next_at);

    CREATE TABLE IF NOT EXISTS account_concurrency (
      account_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      in_flight INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, capability_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ref_image_url TEXT NOT NULL,
      persona TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 10,
      capability_id TEXT NOT NULL,
      model_variant TEXT NOT NULL,
      audio_mode TEXT NOT NULL DEFAULT 'none',
      scene_preference TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS strategies_user_idx ON strategies(user_id);

    CREATE TABLE IF NOT EXISTS tk_bloggers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      homepage_url TEXT NOT NULL,
      handle TEXT NOT NULL,
      nickname TEXT,
      avatar_url TEXT,
      signature TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_crawled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tk_bloggers_user_idx ON tk_bloggers(user_id);

    CREATE TABLE IF NOT EXISTS crawled_videos (
      id TEXT PRIMARY KEY,
      blogger_id TEXT NOT NULL,
      unique_id TEXT NOT NULL,
      title TEXT,
      video_url TEXT NOT NULL,
      download_url TEXT NOT NULL,
      cover_url TEXT,
      duration_sec REAL NOT NULL,
      publish_time INTEGER NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crawled_videos_blogger_idx ON crawled_videos(blogger_id);
    CREATE INDEX IF NOT EXISTS crawled_videos_unique_idx ON crawled_videos(unique_id);

    CREATE TABLE IF NOT EXISTS copycat_strategies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      blogger_ids_json TEXT NOT NULL,
      filter_min_duration REAL,
      filter_max_duration REAL,
      filter_publish_after INTEGER,
      filter_min_play_count INTEGER,
      filter_deduplicate INTEGER NOT NULL DEFAULT 1,
      ref_image_url TEXT NOT NULL,
      persona TEXT NOT NULL,
      style_prompt TEXT NOT NULL,
      output_count INTEGER NOT NULL DEFAULT 1,
      reuse_audio INTEGER NOT NULL DEFAULT 1,
      crawl_interval_hours INTEGER NOT NULL DEFAULT 6,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_executed_at INTEGER,
      dest_folder_id TEXT,
      auto_create_folder INTEGER NOT NULL DEFAULT 0,
      last_run_log TEXT
    );
    CREATE INDEX IF NOT EXISTS copycat_strategies_user_idx ON copycat_strategies(user_id);

    CREATE TABLE IF NOT EXISTS copycat_processed_videos (
      strategy_id TEXT NOT NULL,
      video_unique_id TEXT NOT NULL,
      job_id TEXT,
      processed_at INTEGER NOT NULL,
      PRIMARY KEY (strategy_id, video_unique_id)
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS folders_user_idx ON folders(user_id);
  `);

  // Backward-compatible migrations for existing deployments:
  // add user_id columns to legacy tables if missing.
  const hasColumn = (table: string, col: string) => {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((r) => r.name === col);
  };
  if (!hasColumn('accounts', 'user_id')) {
    sqlite.exec(`ALTER TABLE accounts ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts(user_id)`);
  }
  if (!hasColumn('sessions', 'user_id')) {
    sqlite.exec(`DELETE FROM sessions`);
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`);
  }
  if (!hasColumn('jobs', 'user_id')) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS jobs_user_status_idx ON jobs(user_id, status)`);
  }
  if (!hasColumn('sub_jobs', 'user_id')) {
    sqlite.exec(`ALTER TABLE sub_jobs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sub_jobs_user_status_idx ON sub_jobs(user_id, status)`);
  }
  if (!hasColumn('uploads', 'user_id')) {
    sqlite.exec(`ALTER TABLE uploads ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS uploads_user_idx ON uploads(user_id)`);
  }
  if (!hasColumn('accounts', 'query_endpoint')) {
    sqlite.exec(`ALTER TABLE accounts ADD COLUMN query_endpoint TEXT`);
  }
  if (!hasColumn('strategies', 'audio_mode')) {
    sqlite.exec(`ALTER TABLE strategies ADD COLUMN audio_mode TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!hasColumn('strategies', 'scene_preference')) {
    sqlite.exec(`ALTER TABLE strategies ADD COLUMN scene_preference TEXT`);
  }
  if (!hasColumn('tk_bloggers', 'signature')) {
    sqlite.exec(`ALTER TABLE tk_bloggers ADD COLUMN signature TEXT`);
  }
  if (!hasColumn('crawled_videos', 'cover_url')) {
    sqlite.exec(`ALTER TABLE crawled_videos ADD COLUMN cover_url TEXT`);
  }
  if (!hasColumn('tk_bloggers', 'crawl_error')) {
    sqlite.exec(`ALTER TABLE tk_bloggers ADD COLUMN crawl_error TEXT`);
  }
  if (!hasColumn('jobs', 'folder_id')) {
    sqlite.exec(`ALTER TABLE jobs ADD COLUMN folder_id TEXT`);
  }
  if (!hasColumn('copycat_strategies', 'dest_folder_id')) {
    sqlite.exec(`ALTER TABLE copycat_strategies ADD COLUMN dest_folder_id TEXT`);
  }
  if (!hasColumn('copycat_strategies', 'auto_create_folder')) {
    sqlite.exec(`ALTER TABLE copycat_strategies ADD COLUMN auto_create_folder INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn('copycat_strategies', 'last_run_log')) {
    sqlite.exec(`ALTER TABLE copycat_strategies ADD COLUMN last_run_log TEXT`);
  }
}

