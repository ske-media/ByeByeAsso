# Kroov worker (pg-boss) — build context = repository root:
#   docker build -f infra/docker/worker.Dockerfile -t kroov-worker .
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/notifications/package.json packages/notifications/
COPY packages/payments/package.json packages/payments/
COPY packages/scheduling/package.json packages/scheduling/
COPY packages/ui/package.json packages/ui/
COPY packages/validation/package.json packages/validation/
COPY tests/e2e/package.json tests/e2e/
COPY tests/integration/package.json tests/integration/
COPY tests/security/package.json tests/security/
RUN pnpm install --frozen-lockfile --prefer-offline

FROM node:22-alpine AS runtime
RUN corepack enable && addgroup -S kroov && adduser -S kroov -G kroov
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=kroov:kroov /app ./
COPY --chown=kroov:kroov . .
USER kroov
# Migrations are applied by the worker image before the web rolls out: `pnpm db:migrate`.
CMD ["pnpm", "--filter", "@kroov/worker", "start"]
