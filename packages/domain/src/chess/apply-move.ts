import { Chess, validateFen as chessJsValidateFen } from "chess.js";
import type { ApplyMoveResult, ApplySanResult, MoveInput } from "./types";

/** Re-exports chess.js's FEN validator so callers (apps/web's position editor included) don't
 * need chess.js as a second direct dependency, pinned separately from this package's own. */
export function validateFen(fen: string): { ok: boolean; error?: string } {
  return chessJsValidateFen(fen);
}

/**
 * Converts board input {from,to,promotion?} to normalised SAN (plan §3.2/§4.5 wire-vs-storage
 * boundary). chess.js throws on an illegal move -- including a promoting move with `promotion`
 * omitted (plan §3.1: "not a sufficient move encoding" without it) -- so this is try/catch, not
 * a null check.
 */
export function applyMove(fen: string, move: MoveInput): ApplyMoveResult {
  const fenCheck = validateFen(fen);
  if (!fenCheck.ok) {
    return { ok: false, error: fenCheck.error ?? "Invalid FEN" };
  }

  const chess = new Chess(fen);
  try {
    const result = chess.move(move);
    return { ok: true, san: result.san, fen: chess.fen() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid move" };
  }
}

/** Applies an already-known SAN (e.g. a stored PuzzleMove) rather than board {from,to} input. */
export function applySan(fen: string, san: string): ApplySanResult {
  const fenCheck = validateFen(fen);
  if (!fenCheck.ok) {
    return { ok: false, error: fenCheck.error ?? "Invalid FEN" };
  }

  const chess = new Chess(fen);
  try {
    chess.move(san);
    return { ok: true, fen: chess.fen() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid move" };
  }
}
