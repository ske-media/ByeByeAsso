# Kroov web (Next.js) — multi-stage. Build context = repository root:
#   docker build -f infra/docker/web.Dockerfile -t kroov-web .
# Runtime configuration comes from the environment (see docs/deployment.md); nothing is baked in.
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

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kroov/web build

FROM node:22-alpine AS runtime
RUN corepack enable && addgroup -S kroov && adduser -S kroov -G kroov
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=kroov:kroov /app ./
USER kroov
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["pnpm", "--filter", "@kroov/web", "start"]
