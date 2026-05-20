# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Build stage
FROM base AS builder
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json shared/
COPY shared/src ./shared/src
COPY server/package.json server/tsconfig.json server/
COPY server/src ./server/src
COPY web/package.json web/tsconfig.json web/vite.config.ts web/index.html web/postcss.config.js web/tailwind.config.js web/
COPY web/src ./web/src

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @bvp/shared build
RUN pnpm --filter @bvp/web build
RUN pnpm --filter @bvp/server build

# Runtime stage
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/src ./shared/src
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 8080
CMD ["node", "server/dist/server.js"]
