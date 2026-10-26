# Deployment

Full production deployment steps (Render/Neon/Cloudflare Pages setup, CI release step, CORS
lockdown) ship in Phase 6 (see `docs/implementation-plan.md` §5). This document exists from Phase 0
onward because the hosting decision itself constrains the data layer from day one (see below) — it
cannot be deferred to Phase 6 without risking a late rewrite.

## Phase 6 artifacts (prepared ahead of time)

The following files exist so Phase 6 is "fill in dashboard secrets and run," not "write deploy
config from scratch." **No Docker engine is available on the machine that wrote them**, so every
fix below came from reading real Render build/boot logs across several deploy attempts, not from
local Docker testing. As of the latest commit: the Docker build succeeds, and boot has been
verified as far as Prisma's query engine loading (a `debian-openssl-1.1.x` vs `3.0.x` mismatch was
caught and fixed there) — the fix for that specific failure has not yet been pushed/redeployed, so
a clean `Nest application successfully started` + a 200 on `/api/health` is still unconfirmed.

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build for `apps/api`; runs `prisma migrate deploy` then the app on container start (see in-file comments for why `pnpm deploy`'s package-pruning approach, and `pnpm prune --prod`, were both rejected). |
| `.dockerignore` | Keeps `.env`, `node_modules`, and build output out of the Docker build context. |
| `render.yaml` | Render Blueprint declaring the `chess-tactics-api` web service (Docker runtime, `region: singapore` to sit near the Neon `ap-southeast-1` project, health check at `/api/health`). Secrets are `sync: false` — Render prompts for them once in the dashboard; they are never in the repo. |
| `apps/web/wrangler.toml` + `apps/web`'s new `deploy` script | `pnpm --filter @chess-tactics/web deploy` builds and runs `wrangler pages deploy`, which creates/updates the `chess-tactics-web` Cloudflare Pages project. First use needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` for non-interactive use). |

**Real code changes made to enable this (not just config/docs):**
- `prisma` moved from `devDependencies` to `dependencies` in the root `package.json` — the
  Dockerfile needs the CLI available at container start for `prisma migrate deploy`.
- `packageManager: "pnpm@9.15.9"` pinned in the root `package.json` — an unpinned `corepack enable`
  let the Docker build resolve pnpm >=10, which blocks every dependency's install/postinstall
  script by default (`ERR_PNPM_IGNORED_BUILDS`) and broke the first real Render build.
- `binaryTargets = ["native", "debian-openssl-3.0.x"]` pinned in `prisma/schema.prisma` — the
  Docker build stage generated the Prisma Client before OpenSSL detection could resolve correctly,
  baking in the wrong query-engine binary and crashing the container at boot (`PrismaService.onModuleInit`).

**Still manual when Phase 6 actually runs** (see §6.1–6.3 of the plan): creating the Neon project
and the Render Blueprint itself (Render reads `render.yaml` once you point a Blueprint at this
repo), typing the real secret values into the Render dashboard, and the Cloudflare account
login/authorization for `wrangler`. `VITE_API_URL` must be exported as a shell env var *before*
`pnpm deploy` runs (Vite inlines it at build time — see the comment in `wrangler.toml`), and
`CORS_ORIGIN` on the Render side can only be set correctly *after* the first Pages deploy reveals
the `*.pages.dev` URL — expect to deploy the API once, deploy the frontend, then redeploy the API
with the real `CORS_ORIGIN`.

## Hosting decision (plan §3.6)

- **API**: Render free web service (long-lived Node process).
- **Database**: Neon free Postgres, project created in an **AWS** region (not Azure — Azure regions
  carry a documented 90-day inactivity deletion risk that AWS regions don't).
- **Frontend**: Cloudflare Pages.

**Why this constrains the code (not just the deploy target):** Render runs the API as a long-lived
process, so Prisma's default TCP connection pooling works unmodified — no serverless driver, no Data
Proxy, no edge adapter. Had the choice been an edge/serverless host instead, Prisma would need Neon's
HTTP driver and the data access code in `apps/api` would look different. This is why `prisma/schema.prisma`
(Phase 0.5) and `apps/api`'s Prisma module (Phase 1.2) are written assuming a plain `DATABASE_URL`
connection string and nothing more exotic.

**Accepted tradeoff:** the free Render instance spins down after 15 minutes idle; the first request
after that takes ~60 seconds to wake. The frontend shows an explicit "waking the server" state for
this (Phase 1.6). See `docs/implementation-plan.md` §3.6/§9 for the full evaluation, the rejected
alternatives (self-hosting, Fly.io, Koyeb, Supabase), and the risk/mitigation table.

**Free-tier facts are a 2026-10-22 snapshot** and are not re-verified here. Before relying on them at
signup, confirm the operator checks in plan §10 (no-credit-card signup for Render/Neon, AWS region
availability on Neon's free plan, Lichess puzzle database licence for bulk seed content).

## Local development

```bash
pnpm install
cp .env.example .env        # fill in real values; .env is gitignored
docker compose up -d        # Postgres 16, matches .env.example's DATABASE_URL
pnpm db:migrate             # applies prisma/migrations/ to the local database
pnpm --filter @chess-tactics/api start:dev
pnpm --filter @chess-tactics/web dev
```

**Resolved during Phase 1.** Docker still isn't available in the environment doing this work, but
the owner supplied real Neon (AWS ap-southeast-1) credentials, so `prisma/migrations/20261022000000_init`
was applied for real with `pnpm db:deploy` (`prisma migrate deploy`) against that database, and the
full Phase 1 login → solve → persist flow was verified against it end-to-end (see
`docs/implementation-plan.md` §5 Phase 1's "Verifiable" line). `docker-compose.yml` remains for
anyone who prefers a local Postgres instead of pointing `DATABASE_URL` at the shared Neon project.

## Environment variables

See `.env.example` for the full list with placeholder values. Summary:

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | `apps/api`, Prisma CLI | Postgres connection string. Never committed. |
| `PORT` | `apps/api` | Defaults to `3000` if unset. |
| `JWT_SECRET` | `apps/api` (Phase 1) | Long random value; never committed. |
| `CORS_ORIGIN` | `apps/api` (Phase 1) | The frontend's origin — Cloudflare Pages URL in production, `http://localhost:5173` locally. |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | `apps/api` seed command (Phase 1.4) | Bootstraps the single account. Self-registration is disabled (plan §3.7). |

No secret is ever read by `apps/web` beyond `VITE_API_URL` (added when Phase 1 wires the frontend to
the API) — the browser bundle never sees `DATABASE_URL`, `JWT_SECRET`, or the seed credentials.

## CORS and production configuration

Deferred to Phase 6, where the actual Render/Cloudflare origins are known. Placeholder policy
(plan §4.5, §6 Phase 6.3): the API restricts CORS to exactly the Cloudflare Pages origin, read from
`CORS_ORIGIN`.

## Backup and recovery

The `GET /api/backup` / `POST /api/restore` endpoints (plan §5 Phase 5.4) are the user-facing backup
path once Phase 5 ships. Until then, `pg_dump`/`pg_restore` against the Neon connection string is the
only backup mechanism. Full backup/recovery documentation (`docs/backup-recovery.md`) is a Phase 6.4
deliverable.
