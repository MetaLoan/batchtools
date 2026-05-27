import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    isAdmin: integer('is_admin').notNull().default(0),
    displayName: text('display_name'),
    createdAt: integer('created_at').notNull(),
    lastLoginAt: integer('last_login_at'),
  },
  (t) => ({
    byUsername: index('users_username_idx').on(t.username),
  })
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    apiKeyEncrypted: text('api_key_encrypted').notNull(),
    endpoint: text('endpoint').notNull().default('https://dashscope-intl.aliyuncs.com'),
    queryEndpoint: text('query_endpoint'),
    disableDataInspection: integer('disable_data_inspection').notNull().default(0),
    policyJson: text('policy_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    byUser: index('accounts_user_idx').on(t.userId),
  })
);

export const uploads = sqliteTable(
  'uploads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accountId: text('account_id').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    storagePath: text('storage_path').notNull(),
    signedKey: text('signed_key').notNull(),
    publicUrl: text('public_url').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationSec: real('duration_sec'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({
    byAccount: index('uploads_account_idx').on(t.accountId),
    byExpires: index('uploads_expires_idx').on(t.expiresAt),
  })
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accountId: text('account_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    modelVariant: text('model_variant').notNull(),
    basePrompt: text('base_prompt'),
    baseNegativePrompt: text('base_negative_prompt'),
    baseMediaJson: text('base_media_json').notNull().default('[]'),
    baseParametersJson: text('base_parameters_json').notNull().default('{}'),
    batchMatrixJson: text('batch_matrix_json').notNull().default('{"axes":[]}'),
    totalSubJobs: integer('total_sub_jobs').notNull().default(0),
    status: text('status').notNull(),
    priority: integer('priority').notNull().default(50),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => ({
    byUserStatus: index('jobs_user_status_idx').on(t.userId, t.status),
    byAccountStatus: index('jobs_account_status_idx').on(t.accountId, t.status),
    byCreatedAt: index('jobs_created_at_idx').on(t.createdAt),
  })
);

export const subJobs = sqliteTable(
  'sub_jobs',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    userId: text('user_id').notNull(),
    accountId: text('account_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    indexInJob: integer('index_in_job').notNull(),
    axesJson: text('axes_json').notNull().default('{}'),
    paramsSnapshotJson: text('params_snapshot_json').notNull(),
    status: text('status').notNull(),
    providerTaskId: text('provider_task_id'),
    isSynthetic: integer('is_synthetic').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    lastErrorJson: text('last_error_json'),
    resultUrlsJson: text('result_urls_json'),
    origPrompt: text('orig_prompt'),
    actualPrompt: text('actual_prompt'),
    pollNextAt: integer('poll_next_at'),
    pollStateJson: text('poll_state_json'),
    submittedAt: integer('submitted_at'),
    finishedAt: integer('finished_at'),
    originSubJobId: text('origin_sub_job_id'),
    version: integer('version').notNull().default(1),
  },
  (t) => ({
    byJob: index('sub_jobs_job_idx').on(t.jobId),
    byUserStatus: index('sub_jobs_user_status_idx').on(t.userId, t.status),
    byAccountStatus: index('sub_jobs_account_status_idx').on(t.accountId, t.status),
    byStatusPoll: index('sub_jobs_status_poll_idx').on(t.status, t.pollNextAt),
  })
);

export const accountConcurrency = sqliteTable(
  'account_concurrency',
  {
    accountId: text('account_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    inFlight: integer('in_flight').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.capabilityId] }),
  })
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({
    byUser: index('sessions_user_idx').on(t.userId),
  })
);

export const strategies = sqliteTable(
  'strategies',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    refImageUrl: text('ref_image_url').notNull(),
    persona: text('persona').notNull(),
    duration: integer('duration').notNull().default(10),
    capabilityId: text('capability_id').notNull(),
    modelVariant: text('model_variant').notNull(),
    audioMode: text('audio_mode').notNull().default('none'),
    scenePreference: text('scene_preference'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    byUser: index('strategies_user_idx').on(t.userId),
  })
);

export const tkBloggers = sqliteTable(
  'tk_bloggers',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    homepageUrl: text('homepage_url').notNull(),
    handle: text('handle').notNull(),
    nickname: text('nickname'),
    avatarUrl: text('avatar_url'),
    signature: text('signature'), // blogger biography/description
    crawlError: text('crawl_error'), // error message from last crawl if it failed
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    lastCrawledAt: integer('last_crawled_at'),
  },
  (t) => ({
    byUser: index('tk_bloggers_user_idx').on(t.userId),
  })
);

export const crawledVideos = sqliteTable(
  'crawled_videos',
  {
    id: text('id').primaryKey(),
    bloggerId: text('blogger_id').notNull(),
    uniqueId: text('unique_id').notNull(),
    title: text('title'),
    videoUrl: text('video_url').notNull(),
    downloadUrl: text('download_url').notNull(),
    coverUrl: text('cover_url'), // video preview thumbnail/cover image
    durationSec: real('duration_sec').notNull(),
    publishTime: integer('publish_time').notNull(),
    playCount: integer('play_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    byBlogger: index('crawled_videos_blogger_idx').on(t.bloggerId),
    byUnique: index('crawled_videos_unique_idx').on(t.uniqueId),
  })
);

export const copycatStrategies = sqliteTable(
  'copycat_strategies',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    accountId: text('account_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(), // video_edit | r2v
    bloggerIdsJson: text('blogger_ids_json').notNull(), // JSON array of selected blogger IDs
    filterMinDuration: real('filter_min_duration'),
    filterMaxDuration: real('filter_max_duration'),
    filterPublishAfter: integer('filter_publish_after'),
    filterMinPlayCount: integer('filter_min_play_count'),
    filterDeduplicate: integer('filter_deduplicate').notNull().default(1),
    refImageUrl: text('ref_image_url').notNull(),
    persona: text('persona').notNull(),
    stylePrompt: text('style_prompt').notNull(),
    outputCount: integer('output_count').notNull().default(1),
    reuseAudio: integer('reuse_audio').notNull().default(1),
    crawlIntervalHours: integer('crawl_interval_hours').notNull().default(6),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    lastExecutedAt: integer('last_executed_at'),
  },
  (t) => ({
    byUser: index('copycat_strategies_user_idx').on(t.userId),
  })
);

export const copycatProcessedVideos = sqliteTable(
  'copycat_processed_videos',
  {
    strategyId: text('strategy_id').notNull(),
    videoUniqueId: text('video_unique_id').notNull(),
    jobId: text('job_id'),
    processedAt: integer('processed_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.strategyId, t.videoUniqueId] }),
  })
);

