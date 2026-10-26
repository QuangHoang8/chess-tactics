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
# repo instead reuses the exact module-resolution layout already verified by local
# `pnpm --filter @chess-tactics/api start:dev`, at the cost of also shipping apps/web's prod deps
# AND every workspace's devDependencies (no `pnpm prune --prod` -- see below).
#
# Deliberately NOT running `pnpm prune --prod`: it interactively prompts ("The modules directories
# will be removed and reinstalled from scratch. Proceed?") the first time it runs in this repo's
# pnpm store layout, confirmed locally -- a `RUN` step with no stdin would hit that prompt with EOF
# and most likely no-op or hang rather than actually pruning. A bigger image that is known to build
# beats a smaller one that might not. Revisit only with a real Docker engine to iterate against.
#
# UNVERIFIED: no Docker engine is available on the machine that wrote this file (see
# docs/deployment.md "Local development"). Render's own build is the first real test — if it fails,
# the most likely culprits are (a) a pnpm/corepack version mismatch, or (b) `@node-rs/argon2`
# resolving a prebuilt binary for the wrong libc. This image uses `-bookworm-slim` (glibc, matching
# the `*-gnu` native binary) specifically to avoid (b); switching to an `-alpine` base would require
# confirming a `*-musl` build of `@node-rs/argon2` exists first.

# Pinned to the exact pnpm version this repo was last verified against (matches `packageManager`
# in package.json and .github/workflows/ci.yml's `pnpm/action-setup@v4 version: 9`). Without an
# explicit pin, `corepack enable` lets pnpm resolve to whatever is newest, and pnpm >=10 blocks
# every dependency's install/postinstall script by default (ERR_PNPM_IGNORED_BUILDS) unless
# allow-listed -- which broke the first real Render build (prisma/esbuild/workerd all need their
# postinstall to fetch platform binaries). 9.15.9 predates that default and needs no allow-list.
FROM node:22-bookworm-slim AS build
# openssl here too, not just in the runtime stage: `prisma generate`'s "native" platform detection
# reads the system's actual OpenSSL via this package. Without it, detection silently fell back to
# the wrong default (debian-openssl-1.1.x) instead of Bookworm's real 3.0.x, generating a client
# that didn't match any engine the runtime stage could find -- confirmed by a real Render boot
# failure. `binaryTargets` in prisma/schema.prisma now pins the correct target explicitly too, so
# this is belt-and-suspenders rather than the only fix.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
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
# Generate BEFORE build, not after: `nest build` (plain tsc) type-checks against the generated
# Prisma Client's types (e.g. `$transaction(async (tx) => ...)`'s `tx` parameter has no inferrable
# type without them) -- building first produced 39 implicit-`any` errors on the first real attempt.
RUN pnpm db:generate
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
# openssl is a documented Prisma engine runtime requirement on Debian-based images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo

# --create-home: Prisma's CLI/query engine cache to a $HOME-derived path; a homeless --system user
# (no -m) leaves $HOME unset/pointing at `/`, which can fail at boot with a permission/ENOENT error
# that only shows up once the container actually starts, not during the build.
RUN groupadd --system app && useradd --system --create-home --home-dir /home/app --gid app app
ENV HOME=/home/app
COPY --from=build --chown=app:app /repo /repo
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `prisma migrate deploy` runs on every container start rather than as a separate Render release
# step -- the free plan has no pre-deploy/release-phase hook (plan §6.1). Safe to repeat: applying
# an already-applied migration is a no-op.
#
# Invoking prisma's JS entry directly with `node`, not the `node_modules/.bin/prisma` shim: this
# runtime stage never runs `corepack enable`, so there is no `pnpm` on PATH to run `pnpm exec`/`npx`
# with, and a `.bin` shim's executable bit / relative-path assumptions are one more thing that could
# silently differ from the Windows shim this was authored next to. `node_modules/prisma/package.json`
# names `build/index.js` as its `bin` entry (confirmed locally) -- calling it with `node` sidesteps
# the shim question entirely.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node apps/api/dist/main.js"]
