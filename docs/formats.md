# Import and export formats

Three import formats — **JSON**, **CSV** and **PGN** — two export formats — **JSON** and **CSV** —
and, separately, a full-fidelity backup document (§6). Every import format ends up in the same
place: a `Puzzle` row plus its `PuzzleMove` tree, as defined in
[`implementation-plan.md`](./implementation-plan.md) §4.

Whatever the format, an imported puzzle runs through the **same** `validateSolution` that
`POST /api/puzzles` uses (plan §3.4). There is no laxer import path: an illegal SAN is rejected
with the failing ply, and a solution that ends in a draw rather than mate is flagged the same way.

The parsers live in `packages/domain/src/formats/`.

---

## Choosing a format

| | JSON | CSV | PGN |
|---|---|---|---|
| Alternative solver moves | yes | no | no |
| Branching opponent replies | yes | no | no |
| Per-move comments | yes | no | yes |
| Difficulty / themes / tags | yes | yes | no (defaults) |
| Round-trips a branched puzzle | yes | no | no |

**JSON is the only lossless format.** CSV and PGN both carry a single linear line, so they cannot
express the move *tree* of plan §3.3 — the explicitly accepted alternatives at a ply, and the
opponent replies a puzzle handles. Export a branched puzzle to CSV and you get its primary line
only.

All three are *sharing* formats: they move puzzles between installs. None of them is a backup —
for that, see §6.

---

## 1. JSON

The canonical format. Mirrors the plan §4 data model and the `POST /api/puzzles` body (§4.5)
field for field.

A file is **either** a bare array of puzzles **or** an object with a `puzzles` array — the second
is what `GET /api/puzzles/export?format=json` emits, so an export file re-imports unedited.

```json
{
  "exportedAt": "2026-10-23T09:00:00.000Z",
  "puzzles": [
    {
      "fen": "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
      "difficulty": 2,
      "themes": ["backRankMate"],
      "tags": ["mate-in-1"],
      "source": "Polgar 5334, #12",
      "explanation": "The king has no luft, so the rook mates along the back rank.",
      "moves": [
        {
          "san": "Ra8#",
          "actor": "SOLVER",
          "isPrimary": true,
          "comment": "the only mate",
          "children": []
        }
      ]
    }
  ]
}
```

### Puzzle fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `fen` | string | yes | Full FEN. Validated by `chess.js`'s `validateFen`; the vendor's own error text is reported on failure. |
| `difficulty` | integer 1–5 | yes | Outside the range the record is rejected. |
| `themes` | string[] | no (`[]`) | Free-form, e.g. `backRankMate`, `fork`. |
| `tags` | string[] | no (`[]`) | Free-form. |
| `source` | string | no | Where the puzzle came from. |
| `explanation` | string | no | Shown after the puzzle is solved or skipped. |
| `moves` | TreeNode[] | yes | Must be non-empty, and every root node must be a `SOLVER` move. |

### TreeNode

```ts
{ san: string, actor: "SOLVER" | "OPPONENT", isPrimary: boolean, comment?: string, children: TreeNode[] }
```

- `san` — standard algebraic notation. The parser is lenient about suffixes and disambiguation
  (`Qxf7`, `Qxf7+`, `Qxf7!!` and `Qf3xf7` are all accepted for the same move) but **not** about
  case: `QxF7` is rejected. Whatever you write is stored in its canonical form (`Qxf7` → `Qxf7#`).
- `actor` — `SOLVER` is the side the player moves; `OPPONENT` is the reply. The solver always moves
  first, so the root nodes are `SOLVER` moves and actors alternate down the tree.
- Sibling `SOLVER` nodes are **the accepted alternatives at that ply**. Anything not in the tree is
  rejected during training.
- Sibling `OPPONENT` nodes are the replies the puzzle handles. A legal reply with no node raises a
  *coverage warning* — the import still succeeds.
- `isPrimary` — marks the main line among siblings. It is what CSV export follows.
- `children` — may be omitted on a leaf.

---

## 2. CSV

Flat, one puzzle per row, for bulk collections that have no branching.

```csv
fen,difficulty,themes,tags,source,explanation,solution
"6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",2,backRankMate,mate-in-1,Polgar 5334,"No luft, so the rook mates",Ra8#
"r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4",1,smotheredMate fork,,,,Kd8 Qxf8#
```

### Columns

| Column | Required | Notes |
|---|---|---|
| `fen` | yes | As above. |
| `difficulty` | yes | Integer 1–5. |
| `themes` | yes (may be empty) | **Space**-separated inside the cell, so a theme cannot contain a space. |
| `tags` | yes (may be empty) | Space-separated, same rule. |
| `source` | no | Column may be absent entirely. |
| `explanation` | no | Column may be absent entirely. |
| `solution` | yes | **Space-separated SAN**, alternating from the solver: `SOLVER OPPONENT SOLVER …`. |

A header row is required. Column **order does not matter** and header names are matched
case-insensitively; a file missing one of the required columns is rejected as a whole, because
no row in it could be read.

Quoting is RFC 4180: wrap a field in `"` if it contains a comma, a quote or a newline, and double
any quote inside it. Export does this automatically.

### What CSV cannot say

One row is one linear line. There is no way to write a second accepted first move, or two
different opponent replies. Import such a puzzle as JSON.

> CSV **export** of a branched puzzle writes the `isPrimary` line only — re-importing that file
> gives you a narrower puzzle than you exported.

---

## 3. PGN

Real game files, as produced by Lichess, chess.com, SCID and friends.

### The file is split before it is parsed

`chess.js` 1.4.0's `loadPgn` accepts **exactly one game** and throws
`Expected end of input or whitespace but "[" found` on a concatenated file. The importer therefore
splits the upload itself, cutting at a blank line followed by a tag line. A 500-game file imports
as 500 records; a game that fails to parse is rejected on its own and the rest of the file still
imports.

### `{comment} $NAG` is normalised away

A comment immediately followed by a NAG — `1. e4 {good move} $1 e5` — is the one sequence the
parser rejects. The reverse order (`$1 {good move}`) and a bare NAG both parse fine. Those NAGs
are **stripped** before parsing, and the record's message says how many were removed. Nothing the
data model stores is lost: NAGs are not part of it.

### Variations are dropped, and you are told

`chess.js` parses variations without error and then returns **only the mainline** from `history()`.
A record built from a game containing variations carries the note *"Variations were dropped; only
the mainline was imported"*. Re-author those lines as JSON if you need them.

### The two modes

| Mode | What you get |
|---|---|
| `WHOLE_GAME` | One puzzle per game. Starting position is the game's own (the `[FEN]` header if present, otherwise the initial position); the solution is the whole mainline. |
| `EXTRACT_PLIES` | One puzzle per *(game, ply)* pair. You pass `plies` — zero-based indices into the mainline — and each becomes a puzzle starting at that ply's position, with the rest of the mainline as its solution. |

`EXTRACT_PLIES` exists because a game position is not automatically a puzzle. The importer never
guesses which moments are tactical; you pick them. A ply past the end of a game is rejected as that
one record, leaving the others alone.

> **`WHOLE_GAME` on a file of ordinary games collapses to one puzzle.** Deduplication is by
> position (§4 below), and every game that begins from the standard array has the same starting
> position — so the second and later games come back as `DUPLICATE`. `WHOLE_GAME` is for puzzle
> PGNs, which carry their own `[FEN]`; use `EXTRACT_PLIES` on real games.

### What PGN does not carry

| Field | Imported as |
|---|---|
| `difficulty` | `3` — the middle of the 1–5 scale. PGN has no rating concept. |
| `themes`, `tags` | empty |
| `source` | built from the `Event`, `White`/`Black` and `Date` headers, skipping `?` placeholders |
| `explanation` | not set |
| move comments | carried onto the matching `TreeNode.comment` |

Edit these after importing, or use the preview step to decide not to.

---

## 4. The import flow

Importing is two calls, so nothing is written before you have seen what would be written.

1. **`POST /api/imports`** — multipart: the `file`, plus `kind` (`JSON` | `CSV` | `PGN`), and for
   PGN a `mode` and `plies`. Send an `Idempotency-Key` header. This creates an `ImportBatch` in
   `PREVIEWED` status and returns a per-record report. **Nothing is persisted as a puzzle yet.**
2. **`POST /api/imports/:id/commit`** — optionally `{"skipIndices": [3, 7]}`. This creates the
   `Puzzle` + `PuzzleMove` + `PuzzleCard` rows.

Each record in the report is:

```ts
{ index: number, status: "ACCEPTED" | "REJECTED" | "DUPLICATE", fen?: string, message?: string, duplicateOfPuzzleId?: string }
```

- **ACCEPTED** — parsed and validated; will be created on commit. `message` may still carry notes
  (dropped variations, stripped NAGs, coverage warnings).
- **REJECTED** — malformed, or the solution failed validation. `message` names the failing ply.
  A rejected record never aborts the batch.
- **DUPLICATE** — the position already exists. `duplicateOfPuzzleId` points at the existing puzzle;
  when the collision is with an earlier record in the *same* file it is absent and the message says
  so. Duplicates are skipped on commit.

### Replaying is safe

Two independent mechanisms, per plan §3.5:

- **`Idempotency-Key`** covers *re-sending the same batch*. Replaying a key you have already used
  returns the original batch and its original report — the file is not re-processed (the body you
  send the second time is not even read), and an already-committed batch is not committed twice.
  `totalRows`/`acceptedRows`/`rejectedRows` keep describing the file as previewed; only `status`
  changes once committed, and only a record whose position was created in between flips to
  `DUPLICATE`.
- **`dedupeHash`** — SHA-256 of the FEN with the halfmove and fullmove counters dropped, unique per
  user — covers *the same position arriving from a different batch or source*. That is what turns a
  second upload of the same collection into a report full of `DUPLICATE` and zero new rows.

Deliberately, `dedupeHash` does **not** include the solution: the same position with a different
first move listed first is still the same puzzle (plan §4).

---

## 5. Export

`GET /api/puzzles/export?format=json|csv`, streamed, with a `Content-Disposition` filename.

| Query | Default | Effect |
|---|---|---|
| `format` | `json` | `json` or `csv`. |
| `includeCards` | `false` | Adds scheduling state (`state`, `dueAt`, `intervalDays`, `easeFactor`, `repetitions`, `lapses`). |
| `includeReviews` | `false` | Adds the review history. JSON only — see below. |

JSON export emits the `{exportedAt, puzzles: [...]}` envelope described in §1; with
`includeCards`/`includeReviews` each puzzle gains a `card` object and a `reviews` array. Those extra
keys are ignored on re-import, so a full backup still imports cleanly as puzzles.

CSV export emits the §2 columns, plus the card columns when `includeCards` is set.
`includeReviews` has no effect on CSV — a puzzle has many reviews and the format is one row per
puzzle.

> Export is for moving puzzles between installs. For a complete, restorable backup including
> settings, `GET /api/backup` is the right endpoint — see §6.

---

## 6. Backup and restore

`GET /api/backup` returns one JSON document holding everything stored for the account; `POST
/api/restore` takes that document back. The Settings page drives both.

This is a **different format from §1/§5 export**, and deliberately so. Export drops the columns a
sharing format has no use for — most importantly `ReviewLog.stateBefore`, which is what the queue
builder's new-versus-review split reads, and the FSRS optimiser inputs plan §3.5 exists to
preserve. A collection rebuilt from an export would train differently from the one it came from.
A collection rebuilt from a backup trains identically.

```jsonc
{
  "version": 1,
  "exportedAt": "2026-06-15T12:00:00.000Z",
  "settings": { "timezone": "UTC", "dayRolloverHour": 0, "newPerDay": 20, "reviewsPerDay": null },
  "puzzles":    [ /* every Puzzle column except importBatchId, ids included */ ],
  "moves":      [ /* every PuzzleMove, flat, with parentId intact */ ],
  "cards":      [ /* every PuzzleCard, including learningStep */ ],
  "reviewLogs": [ /* every ReviewLog column, including the FSRS inputs */ ]
}
```

The tables are flat and every primary key travels with its row, because restore has to rebuild the
`parentId` links of the solution tree and each review log's `cardId` exactly as they were.

**Restore replaces.** It deletes the account's puzzles — cascading to their moves, cards and review
logs — and writes the document's rows in their place, all inside one transaction. It does not
merge: merging would double every row on a second restore and collide with the
`(userId, dedupeHash)` uniqueness constraint. The web UI asks for confirmation before sending.

Two checks run before anything is written. The document must declare `version: 1`, and every id a
row points at must exist elsewhere in the same document; a dangling `cardId` or `parentId` is
reported as a `400` naming the row, not as a foreign-key error from inside the transaction.

`ImportBatch` rows are not in the document. A batch records an import run rather than training
data, so restored puzzles simply carry no batch.
