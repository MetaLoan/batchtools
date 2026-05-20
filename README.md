# Batch Video Promoter — AI 推广素材生成平台

纯接口调用平台，对接阿里云 DashScope 新加坡站，把 6 个能力（文生图 / 文生视频 / 图生视频 ×2 / 参考生视频 ×2）整合到一个工作流里：批量扫参、子任务参数微调、多账户隔离、生成策略队列、统一任务历史与素材库。

- **部署形态**：fly.io 一站式（单 Node 进程，前后端打包到同一镜像）
- **存储**：SQLite + fly volume（无 Redis / 无 Postgres / 无对象存储）
- **产物**：DashScope 24h 临时 URL 直接呈现，UI 倒计时提醒下载
- **图片输入**：fly volume 临时图床 + 签名 URL，24h 自动清理
- **批量上限**：单批 ≤500 子任务

## 架构

```
fly.io app
├── Fastify (API + SSE + 静态站点 + 签名图床)
├── SchedulerLoop  (每 1s 提交 PENDING_SUBMIT 子任务)
├── SharedPoller   (每 2s 轮询 SUBMITTED/RUNNING, 全局 ≤14 RPS)
├── CleanupCron    (每 1h 清过期上传, 标记过期产物)
├── SQLite (/data/app.db, WAL)
└── fly volume (/data/uploads/{accountId}/*)
```

详细方案见 [设计文档](~/.claude/plans/ai-doc-doc-ai-spicy-flurry.md)。

## 本地开发

```bash
# Node 20+ & pnpm 9+ required
pnpm install

# 复制环境变量
cp .env.example .env
# 编辑 .env，至少改 APP_PASSWORD 和 MASTER_KEY

# 启动后端 (3000) + 前端 (5173 with /v1 代理)
pnpm dev
```

第一次访问 http://localhost:5173，输入 `APP_PASSWORD` 登录。然后到「账户设置」添加一把 DashScope API Key。

## 部署到 fly.io

```bash
# 一次性
fly launch --copy-config --no-deploy
fly volumes create data --region sin --size 1
fly secrets set APP_PASSWORD=your-strong-password
fly secrets set MASTER_KEY=$(openssl rand -hex 32)
fly secrets set PUBLIC_HOST=https://<your-app>.fly.dev

# 部署
fly deploy
```

## 项目结构

```
batch-video-promoter/
├── shared/         共享 TS 类型 (Capability/Provider/Job/Status)
├── server/         Fastify + Drizzle + 6 个 Provider 实现
│   └── src/
│       ├── providers/dashscope/  6 个 Provider + 共享 base client + capabilities 元数据
│       ├── services/             scheduler / poller / cleanup / job / upload / account
│       ├── routes/               auth / accounts / capabilities / jobs / uploads / stream
│       ├── db/                   schema + better-sqlite3 + migrations
│       └── lib/                  crypto / auth / sse
├── web/            React + AntD + Tailwind + Formily
│   └── src/
│       ├── pages/                Login / Workbench / CapabilityPage / Queue / Tasks / Assets / Settings
│       ├── components/           AppLayout (含手机底部 Tab) / ParamPanel / MediaInputBoard / BatchMatrixDesigner / ...
│       └── lib/                  api / store / sse / format
├── doc/            6 份能力文档
├── Dockerfile      单镜像
├── fly.toml        fly.io 配置 (region=sin, volume=/data)
└── README.md
```

## 6 个能力

| 路径 | 文档 | 模型 |
| --- | --- | --- |
| `/c/qwen.t2i`   | doc/qwen-t2i.md     | qwen-image-2.0-pro / 2.0 / max / plus |
| `/c/wan2.7.t2v` | doc/wan-2.7-t2v.md  | wan2.7-t2v-2026-04-25 |
| `/c/wan2.6.i2v` | doc/wan-2.6-i2v.md  | wan2.6-i2v-flash / wan2.6-i2v / wan2.5-i2v-preview |
| `/c/wan2.7.i2v` | doc/wan-2.7-i2v.md  | wan2.7-i2v-2026-04-25 |
| `/c/wan2.6.r2v` | doc/wan-2.6-r2v.md  | wan2.6-r2v / wan2.6-r2v-flash |
| `/c/wan2.7.r2v` | doc/wan-2.7-r2v.md  | wan2.7-r2v |

## 接入新 Provider

只需新增 3 个文件，业务层零修改：
1. `server/src/providers/<vendor>/<capability>.ts` — 实现 `IProvider`
2. `server/src/providers/<vendor>/capabilities.ts` — 一份 `Capability` 元数据
3. 在 `server/src/providers/index.ts` 的 `registerAllProviders()` 中加一行 `registerProvider(...)`

前端读 `/v1/capabilities` 后自动生成新能力页与参数面板。

## 关键运行参数

- DashScope 提交 RPS：4（全局）+ 账户 `submitRatePerMin` 限速
- DashScope 轮询 RPS：14（全局），自适应间隔 6s→10s→15s→20s→30s
- 单账户默认最大并发：8（可在账户策略调整）
- 子任务自动重试：3 次，10s/30s/90s 退避
