# syntax=docker/dockerfile:1
# 在 WindChime 仓库根目录执行（与 package.json 同级）:
#   docker build -f examples/next-sqlite/Dockerfile -t windchime-next-sqlite .
#
# better-sqlite3 必须在 Linux 镜像内编译，才能得到可在容器内加载的 .node。

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm ci && npm run build

WORKDIR /repo/examples/next-sqlite
COPY examples/next-sqlite/package.json examples/next-sqlite/package-lock.json ./
RUN npm ci
COPY examples/next-sqlite/ ./
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WINDCHIME_DATA_DIR=/data

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --create-home --shell /usr/sbin/nologin nextjs \
  && mkdir -p /data \
  && chown nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /repo/examples/next-sqlite/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/examples/next-sqlite/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/examples/next-sqlite/node_modules/better-sqlite3 ./node_modules/better-sqlite3

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
