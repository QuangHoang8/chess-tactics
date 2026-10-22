# Chess Tactics Trainer — Implementation Plan

**Status:** planning only. No application code was written. The repository is unchanged.
**Date of external research:** 2026-10-22. Free-tier facts are time-sensitive; see §3.6 for what
was verified against vendor docs and what was not.

**Revision note (2026-10-22):** the four §12 open questions were resolved by the product owner after
this plan's first draft. The owner's automated re-planning run failed partway through on this
machine's Archon install (script-type workflow nodes require a `bun` runtime not currently resolvable
on PATH here — a known limitation, not a plan defect), so the four decisions below were applied to
this document by hand instead of via a second automated pass. See §12 for the resolved decisions and
their rationale, and §3.8/§4/§5/§7/§10 for where each one changes the design.

---

## 1. Problem

Build a responsive, mobile-friendly personal web app for managing chess tactical puzzles and
drilling them with Anki-style spaced repetition. Puzzles are stored with their position, solution
line, and metadata; a daily training session serves overdue reviews before new material; review
outcomes feed a scheduler that decides when each puzzle comes back.

The binding constraint is **zero operational cost**: every piece of infrastructure must sit on a
free tier that does not delete the data, and no paid AI or third-party service may be required at
runtime.

---

## 2. Repository inspection summary

Inspected at commit `6ef3de4` on branch `main` (a `master` branch also exists; untouched).

| Path | Contents |
|---|---|
| `README.md` | 14 bytes — the single line `chess-tactics` |
| `.claude/skills/archon-cli/**` | 9 markdown files documenting the Archon CLI skill (workflow authoring, run management, troubleshooting) |
| `.agents/skills/archon-cli/**` | Byte-identical duplicate of the above |

**Findings that shape this plan:**

- The repository is **greenfield**. There is no source code, no `package.json`, no CI, no
  `.gitignore`, no `tsconfig.json`, no lockfile. Every file named in §5 is new unless stated.
- **No project steering documents exist.** There is no `.archon/` directory in the repo, hence no
  `architecture.md`, no `engineering.md`, no direction document, and no
  `.archon/sdlc/policy/rulings.md`. The SDLC pack default at
  `…/bundled/workflows/sdlc/.shared/policy/rulings.md` was read and **records no rulings**
  ("This is the SDLC pack's default rulings document, and it records no rulings").
  Consequence: no design call in this plan is pre-settled by project policy; each is settled below
  by spike evidence, vendor documentation, or an explicit requirement in the request.
- The Archon skill files are tooling documentation only. They contain nothing about application
  architecture and impose no constraint on this design.
- No prior investigation report was supplied to this run.

**Conflict between the request and the run contract (resolved, not blocking).** The request asks
for the plan to be saved as `docs/implementation-plan.md` *in this repo*. The planning node itself
is contractually forbidden from leaving any tree change, so it delivered the plan at its run
artifact path instead. **This copy was written directly into the repo by the orchestrating
session immediately after the plan was produced**, rather than deferred to a later implementation
step — satisfying the request's save location without waiting for Phase 0.

---

## 3. Design decisions

Each decision names what settled it. "Spike" refers to scripts under this run's
`spike/` directory, run against really-installed packages on Node v22.23.1.

### 3.1 Verified third-party behaviour (the evidence base)

In a greenfield repo the only facts a plan can get *wrong* are third-party API surfaces, so these
were spiked rather than recalled. Installed and executed: `chess.js@1.4.0`,
`react-chessboard@5.12.1`, `react@19.3.1`.

**chess.js 1.4.0** (`spike/chessjs-api.js`, `spike/chessjs-san-pgn.js`, `spike/chessjs-pgn-isolate.js`):

| Behaviour | Verified result | Why it matters |
|---|---|---|
| FEN validation | `validateFen` is a **named module export** returning `{ok: boolean, error?: string}`. `new Chess(badFen)` **throws**. | Gives a non-throwing validation path for the API layer; use `validateFen` before constructing. |
| Illegal move | `move()` **throws** `Error: Invalid move: <x>`; it does **not** return `null`. Position is left unchanged. | The entire server-side validation control flow is try/catch, not null-checking. A plan assuming `null` would be wrong. |
| SAN leniency | `Qxf7#`, `Qxf7+`, `Qxf7`, `Qxf7!!`, `Qf3xf7` **all accepted** for the same move. `QxF7` (wrong case) **rejected**. | Imports may carry sloppy SAN; the parser absorbs suffix/disambiguation noise but not case errors. |
| SAN normalisation | `move('Qxf7').san === 'Qxf7#'` — output is canonical with the correct suffix. | Makes normalised SAN a safe canonical storage form. |
| Promotion | `{from:'a7',to:'a8',promotion:'n'}` → `san:'a8=N'`, `lan:'a7a8n'`. Omitting `promotion` on a promoting move **throws**. | `{from,to}` alone is **not** a sufficient move encoding. |
| Castling | `{from:'e1',to:'g1'}` → `san:'O-O'`, `lan:'e1g1'`, `isKingsideCastle()` true. | Board drag input maps cleanly onto castling. |
| Legal replies | `moves({verbose:true})` → `Move` objects carrying `before` and `after` FEN. | Enumerating opponent replies for branch coverage is a one-liner. |
| Per-ply positions | `history({verbose:true})` exposes `before` FEN on every ply. | Clean extraction of a position at ply N for PGN import. |
| PGN: FEN/SetUp | `[FEN]`/`[SetUp]` headers work, with or without `SetUp`, with any starting move number, with or without `4...` black-to-move notation. | Puzzle-style PGNs import fine. |
| PGN: variations | Parsed without error; `history()` returns **mainline only** — variations are silently dropped. | Import must tell the user that variations were discarded, not pretend they were captured. |
| PGN: comments | Multi-line comments, `[%clk]`/`[%eval]` tags all fine. `getComments()` available. | Usable as an explanation source. |
| **PGN: NAG bug** | `1. e4 $1 e5` passes. `1. e4 {good} $1 e5` **FAILS**: `Expected … but "$" found`. `$NAG {comment}` passes. NAG inside a variation passes. | A **comment immediately followed by a NAG** breaks the parser. Real-world annotated PGN hits this. Import must pre-normalise. |
| **PGN: multi-game** | Two concatenated games **FAIL**: `Expected end of input or whitespace but "[" found`. | `loadPgn` handles exactly one game. The importer **must split the file itself**. A plan that assumed multi-game support would be wrong. |
| Instance reuse | `loadPgn` resets prior state; one `Chess` instance can load game after game. | No need to re-allocate per game. |

**react-chessboard 5.12.1** (types read from `dist/Chessboard.d.ts`, `dist/ChessboardProvider.d.ts`):

- The v5 API is **a single `options` prop**: `<Chessboard options={ChessboardOptions} />`. The
  widely-known v4 shape (`position`/`onPieceDrop` as direct props) **does not apply**.
- Relevant `ChessboardOptions` members, confirmed present in the installed types:
  `position?: string | PositionDataType` (accepts a FEN string), `boardOrientation?: 'white'|'black'`,
  `onPieceDrop?: ({piece, sourceSquare, targetSquare}) => boolean` (**returns boolean to accept or
  reject the drop** — this is the legal-move gate), `canDragPiece`, `allowDragging`, `squareStyles`,
  `arrows`, `onSquareClick`, `animationDurationInMs`, `showNotation`.
- **There is no promotion-selection option in v5.** No `onPromotionPieceSelect` or
  `promotionDialogVariant` appears anywhere in `ChessboardOptions`. Combined with the chess.js fact
  that promotion cannot be omitted, **the app must implement its own promotion picker**. This is a
  real, verified piece of scope that is easy to miss.

### 3.2 Move encoding — normalised SAN (decision)

**Chosen:** store each move as a **chess.js-normalised SAN string**, in an ordered tree keyed off
the puzzle's starting FEN.

**Why:** the spike proved SAN round-trips deterministically — sloppy input normalises to canonical
output (`Qxf7` → `Qxf7#`), and board input `{from,to,promotion}` converts to SAN by applying it. SAN
is also what every import source (PGN, Lichess, hand-authored JSON) speaks, and it is readable in
the database during debugging.

**Alternative rejected:** `{from, to, promotion}` (UCI-style). It is position-independent, which is
mildly nicer, but the spike showed a promoting move *throws* when `promotion` is omitted, so the
encoding needs three fields and careful null handling at every boundary; and every import path would
need a SAN→UCI conversion that SAN storage gets for free. Readability in `psql` broke the tie.

**Settled by:** spike evidence (`spike/chessjs-san-pgn.js`, SAN-suffix and normalisation blocks).

This is a **persisted shape**, so it is expensive to change after seed data and imports exist —
which is exactly why it is decided here rather than left to the implementer.

### 3.3 Solution representation — a move tree, not a list of lines (decision)

The request demands two things at once: *"alternative accepted lines"* and *"positions with multiple
legal opponent responses"*. A flat list of linear lines satisfies the first but multiplies
combinatorially against the second (every accepted alternative × every opponent reply becomes its
own row, with no shared prefix).

**Chosen:** a single `PuzzleMove` self-referencing tree per puzzle.

- Each node: `{id, puzzleId, parentId (null at root), ply, san, actor: SOLVER|OPPONENT, isPrimary, comment}`.
- Sibling `SOLVER` nodes under one parent = **the explicitly accepted alternatives at that ply**.
  Anything not present is rejected — satisfying *"accept only explicitly configured alternative
  solutions"* by construction.
- Sibling `OPPONENT` nodes = the replies the puzzle handles. If a position has legal opponent replies
  with no corresponding node, the validator raises a **coverage warning** (see §3.4).
- A node with no `SOLVER` children is a terminal (puzzle solved).

**Settled by:** the two requirements above read together; the spike's branch analysis
(`spike/seed-search.js`) showed a real mate-in-2 where one first move leads to exactly one forced
reply while two sibling alternatives lead to different replies — the tree models this directly.

### 3.4 Server-side validation algorithm (decision)

Proven end-to-end in `spike/seed-verify.js` — `validateSolution(fen, sanLine)` there is the reference
implementation:

1. `validateFen(fen)`; reject with the vendor's error string on `{ok:false}`.
2. Construct `new Chess(fen)`; record `turn()` as the puzzle's side to move.
3. Walk the tree depth-first, applying each `san` inside try/catch; a throw is a per-node rejection
   carrying `{ply, input, error}`.
4. At each `SOLVER` node, record `isCheckmate()` / `isGameOver()`.
5. At each node with `OPPONENT` children, compare the configured replies against
   `moves()` and warn about uncovered legal replies.

Two defects the spike exposed in the naive version, which the real validator must fix:

- **An empty move list passes.** `validateSolution(fen, [])` returned `{ok:true}`. The schema must
  require at least one `SOLVER` move at the root.
- **`isGameOver()` can be true for reasons other than mate.** Several candidate seeds "won" material
  into a K+N-vs-K **insufficient-material draw** which `isGameOver()` reports as true. A terminal
  node must distinguish `isCheckmate()` from `isDraw()`/insufficient material, and a puzzle whose
  solution ends in a draw should be flagged.

### 3.5 Spaced repetition — SM-2, with an FSRS-compatible review log (decision)

**Chosen:** SM-2 for v1, implemented as a pure function in `packages/domain`.

**Alternative rejected:** FSRS. It is the better-calibrated algorithm and is well documented, but its
advantage comes from optimising ~20 parameters against the user's own review history, which a
single-user app will not accumulate for months. Shipping FSRS first means shipping its *default*
parameters — i.e. FSRS's complexity with none of its benefit.

**The decision that actually matters is the review-log shape**, because that is what makes the choice
reversible. `ReviewLog` stores, per review: `rating`, `reviewedAt`, `elapsedDays` (since the previous
review), `scheduledDays` (the interval the card was *given* last time), `intervalBefore`,
`easeBefore`, `repsBefore`, `lapsesBefore`, and `state`. These are exactly FSRS's optimiser inputs, so
a later migration to FSRS needs no backfill and loses no history.

**Scheduling behaviour (explicit, and the subject of §6 tests):**

- Ratings: `AGAIN | HARD | GOOD | EASY`.
- New card → learning steps `[1min, 10min]`; graduating interval 1 day; `EASY` on a new card jumps
  straight to a 4-day interval.
- `AGAIN` → `lapses += 1`, ease `-= 0.20` (floor **1.30**), interval resets to the first learning
  step, card enters `RELEARNING`.
- `HARD` → `interval × 1.2`, ease `-= 0.15`.
- `GOOD` → `interval × ease`.
- `EASY` → `interval × ease × 1.3`, ease `+= 0.15`.
- **Overdue cards** use the *actual* elapsed days, not the scheduled interval, as the multiplication
  base — so a card answered `GOOD` 30 days late schedules from 30, not from its stale interval.
- Interval cap: 365 days. Ease is clamped to `[1.30, 2.50]` at initialisation (start 2.50).

**No claim of Anki compatibility is made.** The request forbids asserting parity without
verification, and no such verification was performed. The parameters above are SM-2-derived defaults
chosen by this plan; they are documented as *this app's* behaviour.

### 3.6 Hosting — Render (compute) + Neon (database) (decision)

This is the decision the request asked to be evaluated explicitly, and the one where recall is least
trustworthy. Findings below are from vendor documentation where marked **[official]** and from
secondary reporting where marked **[secondary]**. **As of 2026-10-22.**

| Candidate | Finding | Source |
|---|---|---|
| **Render Postgres (free)** | **"Free Render Postgres databases expire 30 days after creation."** Then a 14-day grace period, after which "Render **deletes** the database (along with all of its data)." 1 GB, one per workspace. | **[official]** `render.com/docs/free` |
| **Neon (free)** | 1 GB/project, 20 GB account total; 100 CU-hours/project/month; 100 projects; 10 branches/project; auto-suspend "After 5 min inactivity, cannot be disabled". Explicitly: **"None of these limits delete your data."** | **[official]** `neon.com/faqs/free-plan-limits-and-quotas` |
| Neon caveat | Free projects inactive 90+ days **may be deleted** in **Azure** East US 2 / West US 3 / Germany West Central after 2026-10-05. | **[secondary]** Neon changelog via search |
| **Render web service (free)** | 750 free instance hours per workspace per calendar month; spins down after **15 minutes** without inbound traffic; spin-up "takes about one minute". | **[official]** `render.com/docs/free` |
| Fly.io | No longer an always-free platform; trial/usage-based since late 2024. | **[secondary]** |
| Koyeb | Free web service requires a credit card with a ~$29 hold since Feb 2026; sleeps after ~1h. | **[secondary]** |
| Supabase | Permanent free Postgres, 500 MB, but **pauses after ~1 week idle**. | **[secondary]** |

**Decision: Render free web service for the NestJS API + Neon free Postgres for data, Neon project
created in an AWS region.**

The criterion that discriminates is **data persistence**, and it eliminates the obvious one-vendor
answer: Render's own free Postgres is on a 30-day demolition timer, which is disqualifying for a
spaced-repetition app whose entire value is months of accumulated review history. Neon's documented
position is the opposite — suspension never deletes. Choosing an **AWS** region sidesteps the
Azure-only 90-day inactivity deletion; a daily-use personal app would not trip 90 days idle anyway,
but there is no reason to accept the risk.

Render was kept for compute because 750 instance-hours covers a calendar month (744 hours max) and it
needs no card [secondary — **operator must confirm at signup**, see §10]. Frontend goes to **Cloudflare
Pages** as the request proposed; it is a static bundle and the choice is low-stakes and easily moved.

**Alternative rejected — self-hosting (Docker Compose on the owner's own machine or an existing VPS).**
This is genuinely the strongest zero-cost option for a personal app: no cold start, no vendor
retention risk, no quota. It loses on availability — a training app that only works when a home
machine is awake and reachable defeats the point of a mobile-friendly web app, and exposing it needs
either a tunnel or port-forwarding plus TLS. It is retained as the documented **fallback** (§9), and
because the app is a standard Node process plus a Postgres URL, migrating to it costs one
`docker-compose.yml` and a `DATABASE_URL` change.

**Consequence that constrains code, not just deployment:** Render runs a **long-lived Node process**,
so Prisma's default TCP connection pooling works normally and no serverless driver, Data Proxy, or
edge adapter is required. Had the choice been an edge/serverless host, Prisma would have needed
Neon's HTTP driver and the data layer would look different. **This is why the hosting decision sits
in Phase 0 even though deployment ships last** (see §8 and §9).

**Accepted cost:** the first request after 15 idle minutes takes ~1 minute. For once-a-day personal
training this is tolerable, and the frontend will show an explicit "waking the server" state (§5,
Phase 1). A cron pinger to defeat spin-down is **deliberately not planned**: keeping the service
awake would consume ~744 of the 750 monthly hours, leaving no margin for redeploys.

**Does an unlimited review cap (§3.5/§12, owner decision) threaten this budget?** No — instance-hours
are consumed by the process staying *awake*, not by request count or session length within a single
wake window. An unusually large review session (hundreds of cards) adds seconds of CPU time inside a
window that was already billed for 15 minutes of idle-plus-active time; it does not add wake cycles.
The real driver of monthly hour consumption is how many *separate* times per day the service is woken
from cold, which is a function of usage frequency, not queue size. No change to the hosting decision
follows from removing the review cap.

### 3.7 Authentication — single account, JWT, but `userId` in the schema from migration 1 (decision)

The request asks for *"proportionate auth for a personal app"* and, separately, *"per-user isolation
of settings and scheduling data"*. These pull in opposite directions only if isolation is read as
multi-user signup.

**Chosen:** one bootstrapped account (email + Argon2id password hash) issuing a short-lived JWT
access token; **self-registration is disabled** — the initial user is created by a seed command from
env vars. Every user-scoped table (`Puzzle`, `PuzzleCard`, `ReviewLog`, `UserSettings`, `ImportBatch`)
carries a non-null `userId` foreign key **from the first migration**, and every query is scoped by it
through a single request-scoped accessor.

**Why:** isolation is structural and retrofitting a tenant key across five tables plus every query is
a migration-and-audit exercise; adding a registration endpoint later is an afternoon. This satisfies
both lines of the request while building no multi-user surface today.

**Alternative rejected:** a single shared static API key / bearer secret. Simpler, but it gives no
`userId` to hang isolation on, so the schema would have to be reworked the moment a second user (or a
second device profile) appears.

### 3.8 Timezone and daily rollover (decision — owner override, 2026-10-22)

All instants are stored as UTC `timestamptz`. `UserSettings` holds `timezone` (IANA string, default
`UTC`) and `dayRolloverHour` (integer 0–23, **default `0` — midnight**, per owner decision; the plan
originally proposed `4` to let a late-night session count against the previous day, but the owner
chose the simpler midnight boundary instead). "Today" is computed as the civil date in `timezone`
after shifting back by `dayRolloverHour`; at `0` this reduces to the plain civil date, so a session at
00:30 local counts against the *new* day, not the previous one — the owner accepted this tradeoff
explicitly over the late-night-session behaviour a non-zero rollover hour would give. Date maths uses
a single helper in `packages/domain`; no date logic lives in the frontend.

### 3.9 Structure — pnpm workspace monorepo

```
chess-tactics/
├─ apps/
│  ├─ api/                 NestJS 11, TypeScript strict
│  └─ web/                 React 19 + Vite + TypeScript strict
├─ packages/
│  ├─ domain/              PURE TypeScript. No Nest, no React, no Prisma.
│  │                       chess validation + SRS scheduler + rollover maths.
│  └─ contracts/           Zod schemas + inferred DTO types, shared by api and web.
├─ prisma/                 schema.prisma + migrations
├─ docs/
└─ package.json            pnpm workspaces
```

`packages/domain` exists because the request explicitly requires *"scheduling logic as a testable
domain service independent of frontend"* and *"clear separation of … domain logic"*. It is the only
abstraction in this plan not justified by a present caller, and it is justified by that requirement.
`packages/contracts` prevents the frontend and backend drifting on request/response shapes and gives
the API its runtime validation in the same declaration.

---

## 4. Data model

```prisma
enum Actor       { SOLVER OPPONENT }
enum CardState   { NEW LEARNING REVIEW RELEARNING }
enum Rating      { AGAIN HARD GOOD EASY }
enum ImportKind  { JSON CSV PGN }
enum ImportStatus{ PENDING PREVIEWED COMMITTED FAILED }

User          id, email @unique, passwordHash, createdAt
UserSettings  userId @unique → User, timezone (default "UTC"), dayRolloverHour (default 0),
              newPerDay (default 20), reviewsPerDay (nullable Int, default null = unlimited), updatedAt

Puzzle        id, userId → User, fen, sideToMove ('w'|'b'), difficulty (Int 1..5),
              source?, explanation?, themes String[], tags String[],
              dedupeHash @unique([userId, dedupeHash]), importBatchId?,
              createdAt, updatedAt
              @@index([userId, createdAt]) @@index([userId, difficulty])

PuzzleMove    id, puzzleId → Puzzle (onDelete: Cascade), parentId? → PuzzleMove,
              ply Int, san String, actor Actor, isPrimary Boolean, comment?
              @@index([puzzleId, parentId])

PuzzleCard    id, userId → User, puzzleId @unique → Puzzle (onDelete: Cascade),
              state CardState (default NEW), dueAt DateTime, intervalDays Float (default 0),
              easeFactor Float (default 2.5), repetitions Int (default 0),
              lapses Int (default 0), learningStep Int (default 0), lastReviewedAt?
              @@index([userId, dueAt])

ReviewLog     id, userId → User, puzzleId → Puzzle, cardId → PuzzleCard,
              rating Rating, correct Boolean, hintsUsed Int, durationMs Int,
              reviewedAt DateTime, elapsedDays Float, scheduledDays Float,
              intervalBefore Float, easeBefore Float, repsBefore Int, lapsesBefore Int,
              stateBefore CardState
              @@index([userId, reviewedAt]) @@index([cardId, reviewedAt])

ImportBatch   id, userId → User, kind ImportKind, status ImportStatus,
              idempotencyKey, sourceName?, totalRows, acceptedRows, rejectedRows,
              report Json, createdAt
              @@unique([userId, idempotencyKey])

TrainingSession id, userId → User, startedAt, endedAt?, newServed Int, reviewsServed Int,
                currentPuzzleId?    // enables resume-after-refresh
```

**Relations:** `User` 1–1 `UserSettings`; `User` 1–N `Puzzle`/`PuzzleCard`/`ReviewLog`/`ImportBatch`/
`TrainingSession`; `Puzzle` 1–1 `PuzzleCard`; `Puzzle` 1–N `PuzzleMove` (self-referencing tree);
`PuzzleCard` 1–N `ReviewLog`.

**`dedupeHash`** = SHA-256 of the **normalised FEN alone**, where normalising drops the halfmove and
fullmove counters (sources disagree on those for an otherwise identical position).

Deliberately **not** hashed with the solution line. The verified seed `two-rook-ladder` (§7) has three
equally valid first moves; two sources listing a different one first would produce different hashes
and slip past duplicate detection — the exact failure the requirement exists to prevent. Position
identity is the robust key: for tactical puzzles, the same FEN *is* the same puzzle.

Consequence for imports: `@@unique([userId, dedupeHash])` means a colliding record is never silently
inserted. The Phase 3.4 preview reports it as a **duplicate candidate**, showing the stored solution
tree beside the incoming one, and the user chooses *skip* or *merge accepted alternatives into the
existing tree*. `idempotencyKey` covers re-submitting the same batch; `dedupeHash` covers the same
position arriving from different batches or sources.

---

## 4.5 API contracts

All routes are under `/api`, all are authenticated via `Authorization: Bearer <jwt>` except
`POST /api/auth/login`, and all are scoped to the caller's `userId` server-side (§3.7) — `userId`
never appears in a request body or query string.

**Wire vs storage boundary (a decision, stated explicitly).** On the wire a move from the board is
`{from, to, promotion?}`, because that is what `onPieceDrop` yields (§3.1). In storage it is
normalised SAN (§3.2). The API converts at the edge and echoes `normalisedSan` back so the client
never has to parse SAN itself.

**Error envelope (once, for every endpoint):**
`{statusCode, error, message, details?}`. Validation failures use `422` with
`details: [{path, ply?, input?, message}]` — the per-ply shape `validateSolution` already produces
(§3.4). `401` unauthenticated, `403` cross-user, `404` not found, `409` duplicate.

| Endpoint | Request | Success response |
|---|---|---|
| `POST /auth/login` | `{email, password}` | `200 {accessToken, expiresIn}`; `401` on bad credentials |
| `GET /puzzles` | query `cursor?, limit=25, themes[]?, tags[]?, difficulty?, source?, q?, sort=created\|difficulty\|due` | `200 {items: PuzzleSummary[], nextCursor: string\|null}` |
| `GET /puzzles/:id` | — | `200 Puzzle` (full `moves` tree) |
| `POST /puzzles` | `{fen, difficulty, themes[], tags[], source?, explanation?, moves: TreeNode[]}` where `TreeNode = {san, actor, isPrimary, comment?, children: TreeNode[]}` | `201 {id, coverageWarnings[]}`; `422` per-ply errors; `409` duplicate `dedupeHash` |
| `PATCH /puzzles/:id` | same body, all fields optional; re-validates the whole tree when `moves` or `fen` is present | `200 {id, coverageWarnings[]}` |
| `DELETE /puzzles/:id` | — | `204` (cascades `PuzzleMove`, `PuzzleCard`) |
| `GET /training/next` | — | `200 {sessionId, puzzleId, fen, sideToMove, boardOrientation, hintsAvailable, isResume}`; **`204` when the queue is empty** (chosen over a `{done:true}` body so the client branches on status, not payload) |
| `POST /training/attempt` | `{sessionId, puzzleId, move:{from,to,promotion?}}` | `200 {accepted, normalisedSan?, opponentReply?: {san, fen}, solved, remainingPlies}` — `accepted:false` carries no state change |
| `POST /training/hint` | `{sessionId, puzzleId, level: 1\|2\|3}` | `200 {level, text}` |
| `POST /training/skip` | `{sessionId, puzzleId}` | `200 {solutionLine: string[], explanation?}` |
| `POST /training/review` | `{sessionId, puzzleId, rating, hintsUsed, durationMs}` | `200 {nextDueAt, intervalDays, easeFactor, state}` |
| `POST /imports` | multipart file + `{kind: JSON\|CSV\|PGN, mode?: WHOLE_GAME\|EXTRACT_PLIES, plies?: number[]}`, header `Idempotency-Key` → `ImportBatch.idempotencyKey` | `201 {batchId, status: PREVIEWED, totalRows, acceptedRows, rejectedRows, report: ImportRecord[]}` where `ImportRecord = {index, status: ACCEPTED\|REJECTED\|DUPLICATE, fen?, message?, duplicateOfPuzzleId?}`. Replaying the same key returns the **original** report unchanged. |
| `POST /imports/:id/commit` | `{skipIndices?: number[]}` | `200 {batchId, status: COMMITTED, created, skipped}` |
| `GET /imports/:id` | — | `200 ImportBatch` |
| `GET /puzzles/export` | query `format=json\|csv` | `200` file stream |
| `GET /stats` | query `from?, to?, groupBy=theme\|difficulty` | `200 {completed, accuracy, dueNow, remainingNewToday, groups: [{key, count, accuracy}], history: [{date, reviews, accuracy}]}` |
| `GET /settings` / `PATCH /settings` | `{timezone?, dayRolloverHour?, newPerDay?, reviewsPerDay?}` | `200 UserSettings` |
| `GET /backup` | — | `200` single JSON document (puzzles + moves + cards + logs + settings) |
| `POST /restore` | that same document | `200 {restored: {puzzles, cards, logs}}`, transactional |

Every shape above is declared once as a Zod schema in `packages/contracts` and consumed by both
`apps/api` (as the runtime validation pipe) and `apps/web` (as inferred types), so the two cannot
drift.

---

## 5. Phases

Ordered per the request: vertical slice → puzzle management → imports → scheduling → progress →
deployment. Each phase is independently verifiable.

### Phase 0 — Foundation
- **0.1** ~~Copy this document to `docs/implementation-plan.md` and commit~~ — already done by the
  orchestrating session that produced this plan; nothing to do here.
- **0.2** pnpm workspace; root `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`. Every package extends it. `.gitignore`, `.editorconfig`.
- **0.3** Scaffold `apps/api` (NestJS), `apps/web` (Vite + React 19), `packages/domain`,
  `packages/contracts`. Pin `chess.js@1.4.0` and `react-chessboard@5.12.1` — the plan's verified
  facts are version-specific.
- **0.4** Vitest at the root, projects per package. CI workflow running typecheck + lint + test.
- **0.5** `prisma/schema.prisma` with the full §4 model; initial migration; `docker-compose.yml`
  running Postgres 16 for local dev.
- **0.6** Record the §3.6 hosting decision in `docs/deployment.md` **now**, because it determines
  that the API is a long-lived process using standard Prisma TCP pooling.
- **Verifiable:** `pnpm -r typecheck && pnpm -r test` passes on an empty suite; `prisma migrate dev`
  produces the schema; CI green.

### Phase 1 — End-to-end vertical slice
The thinnest path that proves every layer talks: log in, see one seeded puzzle, solve it on a real
board, have the server accept the move and persist a review.

- **1.1** `packages/domain`: `validateSolution(fen, sanTree)` per §3.4, and `applyMove(fen, moveInput)`
  converting `{from,to,promotion}` → normalised SAN.
- **1.2** `apps/api`: Prisma module; `AuthModule` (Argon2id + JWT, no registration endpoint);
  `JwtAuthGuard` applied globally with an explicit `@Public()` opt-out on login only.
- **1.3** Global `ZodValidationPipe` wired to `packages/contracts`. `ValidationPipe` with
  `whitelist` + `forbidNonWhitelisted`.
- **1.4** Seed command creating the bootstrap user from `SEED_USER_EMAIL`/`SEED_USER_PASSWORD` plus
  the four **verified** seed puzzles from §7.
- **1.5** `GET /api/training/next` and `POST /api/training/attempt` (move checked against the tree;
  returns accepted/rejected plus the next expected opponent reply).
- **1.6** `apps/web`: login screen, `<Chessboard options={{...}} />` per the **v5** API of §3.1 —
  `onPieceDrop` returns `false` to reject anything the server-validated tree does not accept.
  **Build the promotion picker** (§3.1: v5 has none and chess.js requires the field).
  A "waking the server…" state on the first request (§3.6 cold start).
- **Verifiable:** log in, solve the back-rank seed on a phone-sized viewport, refresh, see the review
  persisted.

### Phase 2 — Puzzle management
- **2.1** `PuzzlesModule`: `POST/GET/PATCH/DELETE /api/puzzles`, `GET /api/puzzles/:id`.
  Every write runs §3.4 validation **before** persisting and rejects with per-node errors.
- **2.2** List endpoint: pagination (cursor), filter by `themes`, `tags`, `difficulty`,
  `source`, free-text on `explanation`; sort by created/difficulty/due.
- **2.3** Tree editor UI: set up a position, enter the solution, add alternative solver moves and
  opponent replies, see **coverage warnings** for uncovered legal replies (§3.4).
- **2.4** Creating a `Puzzle` creates its `PuzzleCard` in state `NEW` in the same transaction.
- **Verifiable:** CRUD round-trips; an illegal solution is rejected with the failing ply; a puzzle
  with two accepted first moves stores two sibling `SOLVER` roots.

### Phase 3 — Import and export
- **3.1** Documented JSON format (`docs/formats.md`) — the canonical shape, mirroring §4.
- **3.2** CSV format — flat, with the solution line as space-separated SAN; documented column set.
- **3.3** **PGN import**, built directly on the spike findings:
  - **Split the file into games before parsing.** `loadPgn` rejects concatenated games
    (verified). Split on a blank line followed by `[`; `spike/chessjs-pgn-isolate.js` demonstrates a
    working splitter and verifies each piece parses.
  - **Pre-normalise `{comment} $NAG` sequences** (strip the NAG or move it before the comment).
    This ordering is the one verified parser failure.
  - Warn that **variations are dropped** — `history()` returns mainline only (verified).
  - Two explicit modes, as the request requires: *import whole game* vs *extract position(s) at
    selected plies*. Ply selection uses `history({verbose:true})[n].before` (verified available).
    The UI never assumes a game position is a puzzle — the user picks plies.
- **3.4** **Preview before commit**: upload creates an `ImportBatch` in `PREVIEWED` with a per-record
  report (accepted / rejected + reason / duplicate-of). A second call commits it.
- **3.5** Idempotency: `ImportBatch.idempotencyKey` plus `Puzzle.dedupeHash` (§4) make retries safe —
  a re-submitted batch returns the original report rather than double-importing.
- **3.6** Export: JSON and CSV of puzzles plus (optionally) cards and review history.
- **Verifiable:** a multi-game PGN imports as N games; a `{comment} $1` PGN imports after
  normalisation; the same file imported twice yields zero new rows; one malformed record does not
  abort the batch.

### Phase 4 — Scheduling and daily training
- **4.1** `packages/domain/srs.ts`: `schedule(card, rating, now) → nextCard` — pure, no I/O, per §3.5.
- **4.2** `packages/domain/day.ts`: rollover maths per §3.8.
- **4.3** Queue builder: **overdue reviews first, uncapped** (`reviewsPerDay = null` by owner decision
  — every due review is served every day); then new cards capped at `newPerDay` (**default 20**, owner
  override of the original request's stated default of 10). The two limits remain independent in the
  schema (§4) and settings UI (§5.3) even though reviews currently has no ceiling — a future value
  re-imposes one with no migration.
- **4.4** `POST /api/training/review` persists the full `ReviewLog` row (§3.5) inside a transaction
  with the `PuzzleCard` update.
- **4.5** Hints (progressive: theme → first-move piece → first move), explanation on completion,
  skip, completion feedback.
- **4.6** `TrainingSession` resume-after-refresh.
- **Verifiable:** the §6 scheduling table passes; with 50 due and 30 new, a session with
  `reviewsPerDay=null`/`newPerDay=20` serves all 50 reviews then 20 new (10 new puzzles held back for
  the next day).

### Phase 5 — Progress and settings
- **5.1** `GET /api/stats`: completed count, accuracy, due count, remaining new, history series.
- **5.2** Breakdowns grouped by theme and by difficulty.
- **5.3** Settings UI for timezone, rollover hour, and both daily limits.
- **5.4** **Backup/restore**: `GET /api/backup` emitting a single JSON document (puzzles + moves +
  cards + review logs + settings) and `POST /api/restore` consuming it transactionally. This is the
  user-facing mitigation for every free-tier retention risk in §3.6/§9.
- **Verifiable:** backup → wipe a local DB → restore reproduces identical stats.

### Phase 6 — Deployment
- **6.1** Neon project in an **AWS** region (§3.6); `prisma migrate deploy` in the release step.
- **6.2** Render web service from a Dockerfile; env vars `DATABASE_URL`, `JWT_SECRET`,
  `CORS_ORIGIN`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` — **set in the Render dashboard, never
  committed**. No secret ever reaches the frontend bundle; the web app knows only `VITE_API_URL`.
- **6.3** Cloudflare Pages for `apps/web`; CORS on the API restricted to the Pages origin.
- **6.4** `docs/deployment.md`, `docs/backup-recovery.md` (including a scheduled `pg_dump` the owner
  can run locally), and the §9 limitations written out explicitly.
- **Verifiable:** a clean deploy from an empty Neon database serves a login and one training session.

---

## 6. Acceptance criteria and test plan

**`packages/domain` — chess validation (unit, Vitest).** The reference assertions already hold in
`spike/seed-verify.js`:
- Rejects: malformed FEN; FEN with no white king; SAN illegal in the position; a move by the wrong
  side; **an empty solution line** (the gap the spike exposed).
- Accepts and normalises sloppy SAN: `Qxf7`, `Qxf7+`, `Qxf7!!`, `Qf3xf7` all → `Qxf7#`.
- Rejects wrong-case SAN (`QxF7`).
- Promotion: `{from:'a7',to:'a8',promotion:'n'}` → `a8=N`; **omitting `promotion` is an error, not a
  silent queen**.
- Castling `{e1→g1}` → `O-O`.
- Terminal classification distinguishes checkmate from insufficient-material draw.
- Coverage warning fires when a configured opponent node set omits a legal reply.

**`packages/domain` — SRS (unit).** A table-driven suite over §3.5, one case per row:
new card each rating; `AGAIN` resets interval, increments lapses, floors ease at 1.30; `HARD`/`GOOD`/
`EASY` multipliers; **an overdue card schedules from actual elapsed days, not the stale interval**;
repeated `GOOD` reviews grow the interval monotonically to the 365-day cap; ease never leaves
`[1.30, 2.50]`.

**`packages/domain` — rollover (unit).** With `dayRolloverHour=0` (the owner-chosen default), the
computed "today" equals the plain civil date in the user's timezone — a review at 00:01 local counts
against the new day, not the previous one; DST transitions in a non-UTC zone do not double-count or
skip a day. The helper still accepts a non-zero `dayRolloverHour` (tested with `4`, matching the
plan's original rationale) since the schema and settings UI leave it configurable per user.

**Imports (unit).** Multi-game PGN splits into N games; `{comment} $NAG` normalises and then parses;
variation-bearing PGN imports the mainline **and reports the dropped variations**; CSV/JSON malformed
records are reported per-record without aborting the batch; the same batch submitted twice creates
nothing new.

**API (integration, Vitest + Supertest against a Dockerised Postgres).** Login issues a usable JWT;
every private route returns 401 unauthenticated; a puzzle created by user A is invisible to user B
(the §3.7 isolation guarantee); puzzle create rejects an invalid solution with the failing ply;
training queue ordering honours both caps; review persists card + log atomically; backup/restore
round-trips.

**No test is claimed to pass.** None of the above has been executed — the suites do not exist yet.
The spike scripts demonstrate that the *underlying library behaviour* these tests will assert is real.

---

## 7. Seed data — what is actually verified

**Owner decision (2026-10-22): bulk-importing the Lichess CC0 puzzle database is the primary content
strategy**, not a later optional extra as originally proposed. This changes scope, not architecture:
the Phase 3 CSV importer (§5 Phase 3.2) is the mechanism either way, so no new code path is needed —
but the **licence confirmation in §10 is now a Phase 0/1 blocker**, not a someday check, because
without it there is no legal content to seed the app's actual daily-use data with.

- The four hand-verified puzzles below remain in the plan as the **compile-time safety net**: they
  ship as fixtures the Phase 0.4 CI test suite and the Phase 1 seed command can always use, independent
  of any external download, licence confirmation, or network access at setup time.
- The owner should download `database.lichess.org`'s puzzle CSV, confirm its licence (§10.4) before
  import, then run it through the Phase 3.3 CSV importer like any other import batch — the same
  preview-before-commit and duplicate-detection machinery (§3.4, §4 `dedupeHash`) applies, so a bad or
  partial Lichess import is never silently committed.
- Because this is now the *primary* seed path rather than a nice-to-have, Phase 1's vertical slice
  (§5 Phase 1.4) should still seed from the four verified puzzles only — bulk Lichess import is a
  Phase 3 activity by definition, since it depends on the importer that phase builds. The practical
  effect: the app is usable end-to-end from Phase 1 with 4 puzzles, and becomes usable for *real* daily
  training once the owner runs the Lichess import after Phase 3 ships.

Verified by brute force in `spike/seed-verify.js` and `spike/seed-search.js`. The mate-in-1 seeds were
confirmed to have **exactly one** mating move.

| Key | FEN | Solution | Verified |
|---|---|---|---|
| `back-rank-mate` | `6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1` | `Ra8#` | unique mate-in-1 |
| `scholars-mate` | `r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4` | `Qxf7#` | unique mate-in-1 |
| `smothered-mate` | `6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1` | `Nf7#` | unique mate-in-1 |
| `two-rook-ladder` | `7k/8/8/8/8/8/R7/1R5K w - - 0 1` | `Ra7 Kg8 Rb8#` | forced mate-in-2; **three** accepted first moves |

`two-rook-ladder` is deliberately included: it is the seed that exercises both multi-move play and the
§3.3 alternatives model. Its two other accepted lines, both verified forced, are `Rb7 Kg8 Ra8#` and
`Rg1 Kh7 Rh2#`.

**Honest limitation.** Hand-authoring sound tactical content is a content task, not a planning one.
Several candidates I constructed were *unsound* and the spike caught them — a "fork" that won a queen
but reached a K+N-vs-K insufficient-material **draw**, and a "mate in 2" refuted by `Rxa8`. Any seed
added beyond the four above **must be run through the `spike/seed-search.js` harness before being
committed.** For bulk content, the **Lichess puzzle database** (CC0 / public domain, CSV from
`database.lichess.org`, ~6M rated and themed puzzles) is the natural source and maps onto the Phase 3
CSV importer — licence reported by secondary sources and **to be confirmed by the owner at download**.

---

## 8. Inter-phase dependencies

Not merely ordering — these are *consumption* relationships. Breaking one does not delay a phase, it
makes the phase wrong.

| Phase | Hard dependency | What breaks if ignored |
|---|---|---|
| **6 (deploy)** | **Phase 0.6**, not its own position in the sequence | The long-lived-process vs serverless choice determines whether Prisma uses standard TCP pooling or an HTTP driver. Deferring it to Phase 6 means rewriting the data layer at the end. This is the single most dangerous dependency in the plan. |
| **2 (puzzle CRUD)** | Phase 1.1 `validateSolution` + the §3.3 tree model | Puzzle writes are *defined* as "validate the tree, then persist." Without 1.1 there is nothing to validate against and the endpoint has no rejection semantics. |
| **3 (imports)** | Phase 2's validation path | Every imported record must pass through **the same** gate as a hand-created puzzle. Stated explicitly because the natural mistake is writing a second, laxer validator inside the importer — which would let imports create puzzles the CRUD API would reject. |
| **4 (queue builder)** | Phase 2.4 — card created in the same transaction as the puzzle | The queue serves `PuzzleCard` rows in state `NEW`. If puzzle creation does not create the card, there is nothing to serve and the bug surfaces two phases later. |
| **5 (stats)** | Phase 4.4's `ReviewLog` writes | The §3.5 log columns *are* the stats schema. Any column dropped in 4.4 as "unused" becomes an un-backfillable hole in Phase 5 and in a future FSRS migration. |
| **1.6 (board UI)** | §3.1 verified facts | react-chessboard v5's `options`-only API and its missing promotion picker. Building against the v4 prop shape from memory fails at compile time; missing the promotion gap fails at runtime when chess.js throws. |

---

## 9. Risks and rollback

| Risk | Impact | Mitigation |
|---|---|---|
| **Hosting choice constrains code, not just deploy** | Serverless/edge would force Prisma onto an HTTP driver and reshape the data layer. | Decided in Phase 0 (§3.6), not Phase 6, precisely to prevent a late rewrite. This is the dependency most likely to force an architectural change if revisited. |
| **Free-tier terms change** | Research is a 2026-10-22 snapshot; Render's own Postgres already became unusable for this purpose. | Nothing is vendor-specific beyond `DATABASE_URL` and a Dockerfile. Phase 5.4 backup/restore plus `pg_dump` means the data can always leave. Self-hosting is the documented fallback. |
| **Neon auto-suspends after 5 min** | The first query after idle may error while compute wakes. | Prisma connection retry with backoff on the first query of a request. Flagged for the implementer. |
| **Render ~1 min cold start** | Poor first impression daily. | Explicit "waking the server" UI state. Cron ping rejected (§3.6) — it would consume the hour budget. |
| **Neon 90-day inactivity deletion** | Total data loss. | Azure-region-only per the changelog; **use an AWS region**. Daily use never approaches 90 days. Backups are the real guard. |
| **chess.js PGN parser rejects `{comment} $NAG`** | Real annotated PGNs fail to import. | Verified and designed around in Phase 3.3 (pre-normalisation). A plan without the spike would have shipped this bug. |
| **react-chessboard v5 has no promotion UI** | Promotion puzzles unplayable; chess.js throws without the field. | Explicit Phase 1.6 scope. |
| **SM-2 proves unsatisfying** | Poor retention. | §3.5's review log carries FSRS's optimiser inputs, so switching needs no backfill. |
| **Move encoding is a persisted shape** | Changing SAN↔UCI after data exists means a migration. | Decided up front (§3.2) on spike evidence rather than left open. |

**Rollback.** Phases 1–5 are ordinary commits on a feature branch; revert is `git revert`. Schema
changes ship as Prisma migrations, each with a down path; Phase 5.4 backup/restore allows a full
data round-trip independent of schema version. Phase 6 is additive infrastructure — reverting means
deleting the Render service and Cloudflare project; the Neon database outlives both.

---

## 10. Operator checks

These need credentials or a live third-party account and so cannot be proved from this run. They are
not design decisions; they are confirmations to make at setup time.

1. **Render free web service without a credit card** — reported by secondary sources only; Render's
   own free-tier page does not state it. Confirm at signup. If a card is required, the self-host
   fallback (§3.6) applies unchanged.
2. **Neon free plan without a credit card** — likewise not stated on the official limits page.
3. **Neon AWS-region availability** on the free plan at project-creation time.
4. **Lichess puzzle database licence — now blocking (owner decision, §7).** Since bulk Lichess import
   is the primary content strategy rather than an optional extra, confirm CC0 (or equivalent permissive
   terms) on `database.lichess.org` before Phase 3's importer is pointed at it for real content.
   Blocks: real daily-use content, not Phases 0–2 or the Phase 1 vertical slice, which run on the four
   hand-verified seeds regardless of this check's outcome.

---

## 11. Out of scope

Engine analysis or auto-generated puzzle solutions (would need Stockfish server-side; the request
forbids mandatory paid AI and this needs no AI at all); multi-user registration and sharing; puzzle
rating/Elo estimation; opening-repertoire or endgame-tablebase training; mobile native apps; offline
PWA/service-worker sync; i18n; FSRS (§3.5); importing variations from PGN as alternative solution
lines (§3.1 — chess.js drops them; the importer reports this rather than silently losing data).

---

## 12. Open questions — resolved by the owner, 2026-10-22

The four questions below were originally raised as non-blocking defaults. The product owner reviewed
them directly and gave explicit answers, which **override the plan's original defaults** as follows.

**1. Default daily review limit and new-puzzle quota — RESOLVED.**
*Owner's answer:* "Không giới hạn số lượt ôn tập. Nhưng giới hạn số thế cờ cần ôn tập 1 ngày là 20 thế
cờ mới (nếu có)" — no limit on reviews; cap new puzzles introduced per day at 20.
*Resolved as:* `reviewsPerDay = null` (unlimited — every overdue review is served every day, §4.3);
`newPerDay` default changed from the original request's stated `10` to **`20`**.
*Reading note:* the owner's phrase "20 thế cờ mới" (20 *new* positions) is read as `newPerDay=20`, not
a cap on the total daily session size — flag if a session-wide cap was intended instead, since the
queue builder (§4.3) currently treats the two limits as independent by design.
*Where this changes the plan:* §4 schema, §4.3/Phase 4.3 queue builder and its worked example, §6 test
plan is unaffected (the scheduling table doesn't depend on these values), §3.6 (confirmed uncapped
reviews don't affect the Render instance-hour budget).

**2. Daily rollover hour — RESOLVED.**
*Owner's answer:* "midnight."
*Resolved as:* `dayRolloverHour = 0` (was proposed as `4`).
*Where this changes the plan:* §3.8 (rewritten — the "01:00 counts as previous day" rationale no
longer applies at `0`), §6 test plan's rollover unit test.

**3. Cold start vs self-hosting — CONFIRMED, no change.**
*Owner's answer:* "defaults to hosted Render/Neon, accepting the ~60s wake."
*Resolved as:* the plan's original default stands unchanged — Render (API) + Neon (Postgres, AWS
region), accepting the ~1 minute cold-start wake after 15 idle minutes. See §3.6 for the full
evaluation and §9 for the self-host fallback, both unchanged.

**4. Bulk seed content — RESOLVED.**
*Owner's answer:* "bulk-importing the Lichess CC0 puzzle" (database).
*Resolved as:* bulk-importing the Lichess CC0 puzzle database is now the **primary** seed/content
strategy, not a someday option. The four hand-verified puzzles (§7) remain as the Phase 0–1 safety net
that needs no external download or licence confirmation.
*Where this changes the plan:* §7 (rewritten), §10 operator check 4 (now a blocking prerequisite for
real daily-use content, though not for Phases 0–2 or the Phase 1 vertical slice).

**Process note.** These four answers were meant to be folded back into this document via a second
automated `archon-plan` pass, but that rerun failed on this machine: script-type workflow nodes in the
run's attention-loop require a `bun` runtime that isn't currently resolvable on PATH here (the same
class of npm-global-shim-on-Windows issue that initially blocked the `claude` provider binary, fixed
separately for that binary but not yet for `bun`). The edits above were therefore applied directly to
this file rather than regenerated, cross-referenced against every section the four decisions touch.
