# Deployment

Full production deployment steps (Render/Neon/Cloudflare Pages setup, CI release step, CORS
lockdown) ship in Phase 6 (see `docs/implementation-plan.md` §5). This document exists from Phase 0
onward because the hosting decision itself constrains the data layer from day one (see below) — it
cannot be deferred to Phase 6 without risking a late rewrite.

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
