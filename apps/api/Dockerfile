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

FROM base AS runner
WORKDIR /app
COPY --from=installer /app .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@agency-os/api", "start:prod"]
