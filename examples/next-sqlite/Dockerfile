# Build from WindChime repository root. Native SQLite is installed inside Linux.
FROM node:22-bookworm-slim AS builder
# Published SQLite binaries may require a newer glibc than Debian Bookworm.
ENV npm_config_build_from_source=true
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY README.md LICENSE CHANGELOG.md ./
COPY docs ./docs
RUN npm ci
WORKDIR /repo/examples/next-sqlite
COPY examples/next-sqlite/package.json examples/next-sqlite/package-lock.json examples/next-sqlite/.npmrc ./
RUN npm ci --install-links
COPY examples/next-sqlite ./
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build && test -f .next/standalone/server.js

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/windchime.db
RUN mkdir /data && chown node:node /data
COPY --from=builder --chown=node:node /repo/examples/next-sqlite/.next/standalone ./
COPY --from=builder --chown=node:node /repo/examples/next-sqlite/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
