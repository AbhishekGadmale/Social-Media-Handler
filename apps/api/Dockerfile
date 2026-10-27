FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apk add --no-cache libc6-compat curl openssl

FROM base AS builder
WORKDIR /app
RUN npm i -g turbo
COPY . .
RUN turbo prune @agency-os/api --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# We also need pnpm-workspace.yaml if it exists in root
COPY pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
# Generate Prisma Client
RUN pnpm --filter @agency-os/database exec prisma generate
RUN pnpm turbo run build --filter=@agency-os/api
RUN pnpm --config.confirmModulesPurge=false prune --prod
RUN rm -rf \
  apps/api/src \
  apps/api/test \
  apps/api/scripts \
  apps/api/test-argon2.js \
  packages/*/src \
  packages/*/test \
  packages/providers/core \
  packages/providers/linkedin \
  packages/providers/meta \
  packages/providers/storage \
  packages/providers/youtube \
  && find . -depth \( \
    -name ".turbo" -o \
    -name "tsconfig*.json" -o \
    -name "eslint.config.*" -o \
    -name "vitest.config.*" -o \
    -name "jest*.json" -o \
    -name "*.spec.*" -o \
    -name "*.test.*" -o \
    \( -name "*.ts" ! -name "*.d.ts" \) \
  \) -not -path "*/node_modules/*" -exec rm -rf {} +

FROM base AS runner
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=installer --chown=appuser:appgroup /app .

USER appuser

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "apps/api/dist/src/main.js"]
