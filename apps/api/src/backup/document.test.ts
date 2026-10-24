import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT_VERSION, backupDocumentSchema, type BackupDocument } from "@chess-tactics/contracts";
import { referentialErrors } from "./document";

function emptyDocument(overrides: Partial<BackupDocument> = {}): BackupDocument {
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: "2026-06-15T12:00:00.000Z",
    settings: null,
    puzzles: [],
    moves: [],
    cards: [],
    reviewLogs: [],
    ...overrides,
  };
}

const PUZZLE = {
  id: "p1",
  fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
  sideToMove: "w" as const,
  difficulty: 2,
  source: null,
  explanation: null,
  themes: [],
  tags: [],
  dedupeHash: "hash-p1",
  createdAt: "2026-06-15T12:00:00.000Z",
  updatedAt: "2026-06-15T12:00:00.000Z",
};

const MOVE = {
  id: "m1",
  puzzleId: "p1",
  parentId: null,
  ply: 1,
  san: "Ra8#",
  actor: "SOLVER" as const,
  isPrimary: true,
  comment: null,
};

const CARD = {
  id: "c1",
  puzzleId: "p1",
  state: "NEW" as const,
  dueAt: "2026-06-15T12:00:00.000Z",
  intervalDays: 0,
  easeFactor: 2.5,
  repetitions: 0,
  lapses: 0,
  learningStep: 0,
  lastReviewedAt: null,
};

const LOG = {
  id: "r1",
  puzzleId: "p1",
  cardId: "c1",
  rating: "GOOD" as const,
  correct: true,
  hintsUsed: 0,
  durationMs: 1000,
  reviewedAt: "2026-06-15T12:00:00.000Z",
  elapsedDays: 0,
  scheduledDays: 1,
  intervalBefore: 0,
  easeBefore: 2.5,
  repsBefore: 0,
  lapsesBefore: 0,
  stateBefore: "NEW" as const,
};

describe("backupDocumentSchema", () => {
  it("accepts a consistent document", () => {
    const document = emptyDocument({ puzzles: [PUZZLE], moves: [MOVE], cards: [CARD], reviewLogs: [LOG] });
    expect(backupDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("refuses a document written by a different format version", () => {
    expect(backupDocumentSchema.safeParse({ ...emptyDocument(), version: 2 }).success).toBe(false);
  });
});

describe("referentialErrors", () => {
  it("passes a document whose every reference resolves", () => {
    const document = emptyDocument({
      puzzles: [PUZZLE],
      moves: [MOVE, { ...MOVE, id: "m2", parentId: "m1", ply: 2, actor: "OPPONENT" }],
      cards: [CARD],
      reviewLogs: [LOG],
    });
    expect(referentialErrors(document)).toEqual([]);
  });

  it("names the orphaned row and the id it could not find", () => {
    const document = emptyDocument({
      puzzles: [PUZZLE],
      moves: [{ ...MOVE, parentId: "ghost" }],
      cards: [{ ...CARD, puzzleId: "ghost" }],
      reviewLogs: [{ ...LOG, cardId: "ghost" }],
    });

    expect(referentialErrors(document)).toEqual([
      'Move "m1" references unknown parent "ghost"',
      'Card "c1" references unknown puzzle "ghost"',
      'Review log "r1" references unknown card "ghost"',
    ]);
  });

  it("reports a duplicate puzzle id, which would otherwise surface as a unique-constraint error", () => {
    const document = emptyDocument({ puzzles: [PUZZLE, PUZZLE] });
    expect(referentialErrors(document)).toEqual(['Duplicate puzzle id "p1"']);
  });
});
