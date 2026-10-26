# syntax=docker/dockerfile:1.7
#
# Builds and runs apps/api for Render (plan docs/implementation-plan.md §6.2). Render's native
# Node runtime assumes a single-package repo; this is a pnpm workspace where @chess-tactics/api
# depends on packages/domain and packages/contracts via `workspace:*`, so Docker is the simplest
# way to express "install + build the whole workspace, run only apps/api/dist".
#
# Not using `pnpm deploy` to produce a package-scoped prod bundle for apps/api: `prisma generate`'s
# output (node_modules/.prisma/client) is a generated artifact, not a lockfile dependency, so
# `pnpm deploy`'s from-the-lockfile reinstall would not carry it into the deployed folder without
# an explicit Prisma `generator` `output` path (schema.prisma doesn't set one). Copying the whole
# pruned repo instead reuses the exact module-resolution layout already verified by local
# `pnpm --filter @chess-tactics/api start:dev`, at the cost of also shipping apps/web's prod deps.
#
# UNVERIFIED: no Docker engine is available on the machine that wrote this file (see
# docs/deployment.md "Local development"). Render's own build is the first real test — if it fails,
# the most likely culprits are (a) a pnpm/corepack version mismatch, or (b) `@node-rs/argon2`
# resolving a prebuilt binary for the wrong libc. This image uses `-bookworm-slim` (glibc, matching
# the `*-gnu` native binary) specifically to avoid (b); switching to an `-alpine` base would require
# confirming a `*-musl` build of `@node-rs/argon2` exists first.

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo

# Copy manifests first so `pnpm install` is cached unless a dependency actually changed.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY . .

# `prisma generate` only reads prisma/schema.prisma -- it never opens a connection -- so a
# syntactically valid placeholder is enough (mirrors .github/workflows/ci.yml). The real
# DATABASE_URL is supplied by Render as a runtime env var, for `prisma migrate deploy` and the app.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"
RUN pnpm build
RUN pnpm prune --prod
# Generated last, after the prod prune: node_modules/.prisma/client is a generated artifact, not a
# lockfile entry, so pruning first and generating after guarantees the prune can't sweep it away.
RUN pnpm db:generate

FROM node:22-bookworm-slim AS runtime
# openssl is a documented Prisma engine runtime requirement on Debian-based images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo

RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /repo /repo
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `prisma migrate deploy` runs on every container start rather than as a separate Render release
# step -- the free plan has no pre-deploy/release-phase hook (plan §6.1). Safe to repeat: applying
# an already-applied migration is a no-op.
#
# Calling the `prisma` bin directly (not `pnpm exec`/`npx`): this runtime stage never runs
# `corepack enable`, so there is no `pnpm` on PATH here, and the `app` user (no home dir) can't do
# corepack's first-use package-manager fetch anyway. `prisma` is a root prod dependency, so its bin
# link lives at the repo root's node_modules/.bin regardless of which workspace package needs it.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node apps/api/dist/main.js"]
