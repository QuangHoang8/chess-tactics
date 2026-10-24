import type { BackupDocument } from "@chess-tactics/contracts";

/**
 * Checks the links the Zod schema cannot: every id a row points at has to exist elsewhere in the
 * same document. Without this the first bad reference surfaces as a raw Postgres foreign-key
 * violation from somewhere inside the restore transaction, naming a constraint rather than the
 * row the user would have to fix.
 */
export function referentialErrors(document: BackupDocument): string[] {
  const errors: string[] = [];

  const puzzleIds = new Set<string>();
  for (const puzzle of document.puzzles) {
    if (puzzleIds.has(puzzle.id)) {
      errors.push(`Duplicate puzzle id "${puzzle.id}"`);
    }
    puzzleIds.add(puzzle.id);
  }

  const moveIds = new Set(document.moves.map((move) => move.id));
  for (const move of document.moves) {
    if (!puzzleIds.has(move.puzzleId)) {
      errors.push(`Move "${move.id}" references unknown puzzle "${move.puzzleId}"`);
    }
    if (move.parentId !== null && !moveIds.has(move.parentId)) {
      errors.push(`Move "${move.id}" references unknown parent "${move.parentId}"`);
    }
  }

  const cardIds = new Set(document.cards.map((card) => card.id));
  for (const card of document.cards) {
    if (!puzzleIds.has(card.puzzleId)) {
      errors.push(`Card "${card.id}" references unknown puzzle "${card.puzzleId}"`);
    }
  }

  for (const log of document.reviewLogs) {
    if (!puzzleIds.has(log.puzzleId)) {
      errors.push(`Review log "${log.id}" references unknown puzzle "${log.puzzleId}"`);
    }
    if (!cardIds.has(log.cardId)) {
      errors.push(`Review log "${log.id}" references unknown card "${log.cardId}"`);
    }
  }

  return errors;
}
