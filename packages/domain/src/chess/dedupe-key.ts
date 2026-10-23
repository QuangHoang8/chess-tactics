/**
 * Plan §4: `Puzzle.dedupeHash` is a hash of the normalised FEN alone (deliberately excluding the
 * solution line -- see the plan's rationale on `two-rook-ladder`'s three equally valid first moves).
 * Normalising drops the halfmove/fullmove counters, which sources disagree on for an otherwise
 * identical position.
 *
 * This returns the string to hash, not the hash itself -- hashing needs `node:crypto`, which must
 * stay out of this package (apps/web may one day import @chess-tactics/domain for client-side
 * preview, and a Node-only import here would break that build). Callers (apps/api, prisma/seed.ts)
 * hash this with SHA-256 themselves.
 */
export function dedupeKeyOf(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}
