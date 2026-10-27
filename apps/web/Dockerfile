FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apk add --no-cache libc6-compat curl

FROM base AS builder
WORKDIR /app
RUN npm i -g turbo
COPY . .
RUN turbo prune @agency-os/web --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:3001/api/v1}
RUN pnpm turbo run build --filter=@agency-os/web
RUN pnpm --config.confirmModulesPurge=false prune --prod
RUN rm -rf \
  apps/web/src \
  apps/web/test-setup.ts \
  && find . -depth \( \
    -name ".turbo" -o \
    -name "tsconfig*.json" -o \
    -name "eslint.config.*" -o \
    -name "vitest.config.*" -o \
    -name "jest*.json" -o \
    -name "*.spec.*" -o \
    -name "*.test.*" \
  \) -not -path "*/node_modules/*" -exec rm -rf {} +

FROM base AS runner
WORKDIR /app/apps/web
ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=installer --chown=appuser:appgroup /app /app

USER appuser

EXPOSE 3000

ENV PORT=3000

CMD ["node", "node_modules/next/dist/bin/next", "start"]
