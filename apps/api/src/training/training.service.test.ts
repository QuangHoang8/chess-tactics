import { beforeEach, describe, expect, it } from "vitest";
import { FakeTrainingPrisma } from "./fake-prisma";
import { TrainingService } from "./training.service";
import { pickNextCard } from "./queue";
import type { EffectiveSettings } from "./settings";

const USER = "user-1";

// Phan §7 back-rank-mate: a single SOLVER move, no opponent reply -- exercises the "solved
// immediately" branch of attempt().
const BACK_RANK_FEN = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";

// Plan §7 two-rook-ladder (first line only): SOLVER -> OPPONENT -> SOLVER#, exercises the
// opponent-auto-reply branch and multi-step resume.
const LADDER_FEN = "7k/8/8/8/8/8/R7/1R5K w - - 0 1";

function defaultSettings(overrides: Partial<EffectiveSettings> = {}): EffectiveSettings {
  return { timezone: "UTC", dayRolloverHour: 0, newPerDay: 20, reviewsPerDay: null, ...overrides };
}

function seedBackRankPuzzle(fake: FakeTrainingPrisma, userId = USER) {
  const puzzle = fake.seedPuzzle({
    userId,
    fen: BACK_RANK_FEN,
    sideToMove: "w",
    themes: ["backRankMate"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  fake.seedMove({ puzzleId: puzzle.id, san: "Ra8#", actor: "SOLVER", isPrimary: true });
  const card = fake.seedCard({ userId, puzzleId: puzzle.id, state: "NEW", dueAt: new Date("2026-01-01T00:00:00Z") });
  return { puzzle, card };
}

function seedLadderPuzzle(fake: FakeTrainingPrisma, userId = USER) {
  const puzzle = fake.seedPuzzle({
    userId,
    fen: LADDER_FEN,
    sideToMove: "w",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  });
  const move1 = fake.seedMove({ puzzleId: puzzle.id, parentId: null, san: "Ra7", actor: "SOLVER", isPrimary: true });
  const reply = fake.seedMove({ puzzleId: puzzle.id, parentId: move1.id, san: "Kg8", actor: "OPPONENT", isPrimary: true });
  fake.seedMove({ puzzleId: puzzle.id, parentId: reply.id, san: "Rb8#", actor: "SOLVER", isPrimary: true });
  const card = fake.seedCard({ userId, puzzleId: puzzle.id, state: "NEW", dueAt: new Date("2026-01-02T00:00:00Z") });
  return { puzzle, card, move1, reply };
}

describe("TrainingService.getNext / attempt -- back-rank mate (one-move solve)", () => {
  let fake: FakeTrainingPrisma;
  let service: TrainingService;

  beforeEach(() => {
    fake = new FakeTrainingPrisma();
    service = new TrainingService(fake.asPrisma());
  });

  it("serves the NEW card and solving it marks the session solved", async () => {
    seedBackRankPuzzle(fake);

    const next = await service.getNext(USER);
    expect(next).not.toBeNull();
    expect(next?.fen).toBe(BACK_RANK_FEN);
    expect(next?.solved).toBe(false);

    const result = await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a1", to: "a8" },
    });
    expect(result.accepted).toBe(true);
    expect(result.solved).toBe(true);
    expect(result.normalisedSan).toBe("Ra8#");

    expect(fake.sessions.find((s) => s.id === next!.sessionId)?.solved).toBe(true);
  });

  it("rejects an illegal move without changing session state, and tracks the rejection", async () => {
    seedBackRankPuzzle(fake);
    const next = await service.getNext(USER);

    const result = await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a1", to: "a2" }, // legal rook move, but not the puzzle's accepted line... actually a1-a2 is legal chess-wise but wrong line
    });
    expect(result.accepted).toBe(false);
    expect(fake.sessions.find((s) => s.id === next!.sessionId)?.hadRejectedAttempt).toBe(true);
  });

  it("returns an explanation on solve when the puzzle has one", async () => {
    const { puzzle } = seedBackRankPuzzle(fake);
    fake.puzzles.find((p) => p.id === puzzle.id)!.explanation = "Back rank weakness.";
    const next = await service.getNext(USER);

    const result = await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a1", to: "a8" },
    });
    expect(result.explanation).toBe("Back rank weakness.");
  });
});

describe("TrainingService -- multi-ply puzzle with an opponent reply, and resume", () => {
  let fake: FakeTrainingPrisma;
  let service: TrainingService;

  beforeEach(() => {
    fake = new FakeTrainingPrisma();
    service = new TrainingService(fake.asPrisma());
  });

  it("plays the opponent's auto-reply and a refresh resumes mid-tree", async () => {
    seedLadderPuzzle(fake);
    const next = await service.getNext(USER);

    const afterFirst = await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a2", to: "a7" },
    });
    expect(afterFirst.accepted).toBe(true);
    expect(afterFirst.solved).toBe(false);
    expect(afterFirst.opponentReply?.san).toBe("Kg8");

    // Simulate a refresh: no sessionId known client-side, just GET /training/next again.
    const resumed = await service.getNext(USER);
    expect(resumed?.isResume).toBe(true);
    expect(resumed?.sessionId).toBe(next!.sessionId);
    expect(resumed?.fen).toBe(afterFirst.opponentReply!.fen);

    const afterSecond = await service.attempt(USER, {
      sessionId: resumed!.sessionId,
      puzzleId: resumed!.puzzleId,
      move: { from: "b1", to: "b8" },
    });
    expect(afterSecond.solved).toBe(true);
    expect(afterSecond.normalisedSan).toBe("Rb8#");
  });

  it("closes out a stale open session instead of resuming it", async () => {
    seedLadderPuzzle(fake);
    const stale = await fake.trainingSession.create({
      data: { userId: USER, currentPuzzleId: null },
    });
    // Backdate it past the 24h resume window.
    fake.sessions.find((s) => s.id === stale.id)!.startedAt = new Date(Date.now() - 48 * 3600 * 1000);

    const next = await service.getNext(USER);
    expect(next?.isResume).toBe(false);
    expect(fake.sessions.find((s) => s.id === stale.id)?.endedAt).not.toBeNull();
  });
});

describe("TrainingService.hint", () => {
  it("level 1 returns themes, level 2 the piece, level 3 the move", async () => {
    const fake = new FakeTrainingPrisma();
    const service = new TrainingService(fake.asPrisma());
    seedBackRankPuzzle(fake);
    const next = await service.getNext(USER);
    const base = { sessionId: next!.sessionId, puzzleId: next!.puzzleId };

    expect((await service.hint(USER, { ...base, level: 1 })).text).toContain("backRankMate");
    expect((await service.hint(USER, { ...base, level: 2 })).text).toContain("rook");
    expect((await service.hint(USER, { ...base, level: 3 })).text).toContain("Ra8#");
  });
});

describe("TrainingService.skip", () => {
  it("reveals the full primary line and marks the session skipped", async () => {
    const fake = new FakeTrainingPrisma();
    const service = new TrainingService(fake.asPrisma());
    seedLadderPuzzle(fake);
    const next = await service.getNext(USER);

    const result = await service.skip(USER, { sessionId: next!.sessionId, puzzleId: next!.puzzleId });
    expect(result.solutionLine).toEqual(["Ra7", "Kg8", "Rb8#"]);
    expect(fake.sessions.find((s) => s.id === next!.sessionId)?.skipped).toBe(true);
  });
});

describe("TrainingService.review", () => {
  let fake: FakeTrainingPrisma;
  let service: TrainingService;

  beforeEach(() => {
    fake = new FakeTrainingPrisma();
    service = new TrainingService(fake.asPrisma());
  });

  it("rejects a review before the puzzle is solved or skipped", async () => {
    seedBackRankPuzzle(fake);
    const next = await service.getNext(USER);
    await expect(
      service.review(USER, {
        sessionId: next!.sessionId,
        puzzleId: next!.puzzleId,
        rating: "GOOD",
        hintsUsed: 0,
        durationMs: 1000,
      }),
    ).rejects.toThrow();
  });

  it("persists a ReviewLog and advances the PuzzleCard after a clean solve", async () => {
    const { card } = seedBackRankPuzzle(fake);
    const next = await service.getNext(USER);
    await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a1", to: "a8" },
    });

    const result = await service.review(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      rating: "GOOD",
      hintsUsed: 1,
      durationMs: 4200,
    });

    expect(result.state).toBe("LEARNING");
    expect(fake.reviewLogs).toHaveLength(1);
    expect(fake.reviewLogs[0]?.correct).toBe(true);
    expect(fake.reviewLogs[0]?.hintsUsed).toBe(1);
    expect(fake.cards.find((c) => c.id === card.id)?.state).toBe("LEARNING");
    expect(fake.sessions.find((s) => s.id === next!.sessionId)?.endedAt).not.toBeNull();
  });

  it("records correct:false for a skipped puzzle even if the player rates it GOOD", async () => {
    seedLadderPuzzle(fake);
    const next = await service.getNext(USER);
    await service.skip(USER, { sessionId: next!.sessionId, puzzleId: next!.puzzleId });

    await service.review(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      rating: "GOOD",
      hintsUsed: 0,
      durationMs: 9000,
    });

    expect(fake.reviewLogs[0]?.correct).toBe(false);
    expect(fake.reviewLogs[0]?.rating).toBe("GOOD");
  });

  it("records correct:false when a wrong attempt preceded an eventual solve", async () => {
    seedBackRankPuzzle(fake);
    const next = await service.getNext(USER);
    await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a1", to: "a2" },
    });
    await service.attempt(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      move: { from: "a1", to: "a8" },
    });

    await service.review(USER, {
      sessionId: next!.sessionId,
      puzzleId: next!.puzzleId,
      rating: "EASY",
      hintsUsed: 0,
      durationMs: 5000,
    });

    expect(fake.reviewLogs[0]?.correct).toBe(false);
  });
});

describe("pickNextCard -- queue ordering (plan §4.3)", () => {
  it("serves overdue reviews before any NEW card, uncapped by default", async () => {
    const fake = new FakeTrainingPrisma();
    const { puzzle: duePuzzle } = seedBackRankPuzzle(fake);
    fake.cards.find((c) => c.puzzleId === duePuzzle.id)!.state = "REVIEW";
    fake.cards.find((c) => c.puzzleId === duePuzzle.id)!.dueAt = new Date("2020-01-01T00:00:00Z");
    seedLadderPuzzle(fake); // left as NEW

    const picked = await pickNextCard(fake.asPrisma(), USER, defaultSettings(), new Date());
    expect(picked?.puzzleId).toBe(duePuzzle.id);
  });

  it("caps NEW cards served per day at newPerDay once no reviews are due", async () => {
    const fake = new FakeTrainingPrisma();
    const { puzzle } = seedBackRankPuzzle(fake);
    const settings = defaultSettings({ newPerDay: 1 });
    const now = new Date("2026-06-01T12:00:00Z");

    const first = await pickNextCard(fake.asPrisma(), USER, settings, now);
    expect(first?.puzzleId).toBe(puzzle.id);

    // One NEW card already served (reviewed) today -- budget exhausted.
    fake.seedReviewLog({
      userId: USER,
      puzzleId: puzzle.id,
      cardId: fake.cards[0]!.id,
      rating: "GOOD",
      correct: true,
      hintsUsed: 0,
      durationMs: 1000,
      reviewedAt: now,
      elapsedDays: 0,
      scheduledDays: 0,
      intervalBefore: 0,
      easeBefore: 2.5,
      repsBefore: 0,
      lapsesBefore: 0,
      stateBefore: "NEW",
    });

    const second = await pickNextCard(fake.asPrisma(), USER, settings, now);
    expect(second).toBeNull();
  });
});
