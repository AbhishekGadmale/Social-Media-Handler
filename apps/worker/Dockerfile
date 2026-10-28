FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apk add --no-cache libc6-compat curl openssl

FROM base AS builder
WORKDIR /app
RUN npm i -g turbo
COPY . .
RUN turbo prune @agency-os/worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
# Generate Prisma Client
RUN pnpm --filter @agency-os/database exec prisma generate
RUN pnpm turbo run build --filter=@agency-os/worker

# Preserve generated Prisma client before reinstalling dependencies
RUN mkdir -p /tmp/prisma-generated && \
    cp -r node_modules/.pnpm/@prisma+client*/node_modules/.prisma /tmp/prisma-generated/

# Reinstall strictly production dependencies across all workspace packages
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules
RUN pnpm install --prod --frozen-lockfile

# Restore the generated Prisma client into the production node_modules
RUN cp -r /tmp/prisma-generated/.prisma node_modules/.pnpm/@prisma+client*/node_modules/ && \
    mkdir -p node_modules/.prisma && \
    cp -r /tmp/prisma-generated/.prisma/* node_modules/.prisma/ && \
    rm -rf /tmp/prisma-generated

RUN rm -rf \
  apps/worker/src \
  apps/worker/test \
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

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/main.js"]
