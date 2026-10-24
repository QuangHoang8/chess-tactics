import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_FORMAT_VERSION, type BackupDocument, type StatsQuery } from "@chess-tactics/contracts";
import { FakePrisma } from "../test-support/fake-prisma";
import { StatsService } from "../stats/stats.service";
import { BackupService } from "./backup.service";

const USER = "user-1";
const QUERY: StatsQuery = { groupBy: "theme" };

const NOW = new Date();
const HOUR_AGO = new Date(NOW.getTime() - 3_600_000);

/** A collection exercising every link the document has to carry: a two-ply solution tree, cards in
 * different states, and reviews that differ in `correct` and in `stateBefore`. */
function seedCollection(fake: FakePrisma): void {
  // UTC with a midnight rollover keeps "today" unambiguous, so `remainingNewToday` below is a
  // fixed number rather than one that depends on when the suite happens to run.
  fake.settings.push({ userId: USER, timezone: "UTC", dayRolloverHour: 0, newPerDay: 7, reviewsPerDay: 25 });

  fake.puzzles.push(
    {
      id: "p1",
      userId: USER,
      fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
      sideToMove: "w",
      difficulty: 2,
      source: "lichess",
      explanation: "Back-rank mate.",
      themes: ["backRankMate", "mateIn1"],
      tags: ["starter"],
      dedupeHash: "hash-p1",
      createdAt: HOUR_AGO,
      updatedAt: HOUR_AGO,
    },
    {
      id: "p2",
      userId: USER,
      fen: "7k/8/8/8/8/8/R7/1R5K w - - 0 1",
      sideToMove: "w",
      difficulty: 4,
      source: null,
      explanation: null,
      themes: [],
      tags: [],
      dedupeHash: "hash-p2",
      createdAt: HOUR_AGO,
      updatedAt: HOUR_AGO,
    },
  );

  fake.moves.push(
    { id: "m1", puzzleId: "p1", parentId: null, ply: 1, san: "Ra8#", actor: "SOLVER", isPrimary: true, comment: null },
    { id: "m2", puzzleId: "p2", parentId: null, ply: 1, san: "Ra7", actor: "SOLVER", isPrimary: true, comment: "ladder" },
    { id: "m3", puzzleId: "p2", parentId: "m2", ply: 2, san: "Kg8", actor: "OPPONENT", isPrimary: true, comment: null },
    { id: "m4", puzzleId: "p2", parentId: "m3", ply: 3, san: "Rb8#", actor: "SOLVER", isPrimary: true, comment: null },
  );

  fake.cards.push(
    {
      id: "c1",
      userId: USER,
      puzzleId: "p1",
      state: "REVIEW",
      dueAt: HOUR_AGO,
      intervalDays: 6,
      easeFactor: 2.6,
      repetitions: 3,
      lapses: 1,
      learningStep: 0,
      lastReviewedAt: HOUR_AGO,
    },
    {
      id: "c2",
      userId: USER,
      puzzleId: "p2",
      state: "NEW",
      dueAt: NOW,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
      learningStep: 0,
      lastReviewedAt: null,
    },
  );

  fake.reviewLogs.push(
    {
      id: "r1",
      userId: USER,
      puzzleId: "p1",
      cardId: "c1",
      rating: "GOOD",
      correct: true,
      hintsUsed: 0,
      durationMs: 4200,
      reviewedAt: NOW,
      elapsedDays: 6,
      scheduledDays: 6,
      intervalBefore: 2.5,
      easeBefore: 2.5,
      repsBefore: 2,
      lapsesBefore: 1,
      stateBefore: "REVIEW",
    },
    {
      id: "r2",
      userId: USER,
      puzzleId: "p2",
      cardId: "c2",
      rating: "AGAIN",
      correct: false,
      hintsUsed: 2,
      durationMs: 31000,
      reviewedAt: NOW,
      elapsedDays: 0,
      scheduledDays: 0,
      intervalBefore: 0,
      easeBefore: 2.5,
      repsBefore: 0,
      lapsesBefore: 0,
      stateBefore: "NEW",
    },
  );
}

describe("BackupService", () => {
  let fake: FakePrisma;
  let service: BackupService;

  beforeEach(() => {
    fake = new FakePrisma();
    service = new BackupService(fake.asPrisma());
  });

  it("carries every scheduling column, including the ones GET /puzzles/export drops", async () => {
    seedCollection(fake);

    const document = await service.backup(USER);

    expect(document.version).toBe(BACKUP_FORMAT_VERSION);
    expect(document.settings).toEqual({
      timezone: "UTC",
      dayRolloverHour: 0,
      newPerDay: 7,
      reviewsPerDay: 25,
    });
    expect(document.reviewLogs[0]).toMatchObject({
      id: "r1",
      cardId: "c1",
      stateBefore: "REVIEW",
      elapsedDays: 6,
      scheduledDays: 6,
      intervalBefore: 2.5,
      easeBefore: 2.5,
      repsBefore: 2,
      lapsesBefore: 1,
    });
    expect(document.cards[0]).toMatchObject({ id: "c1", learningStep: 0, repetitions: 3, lapses: 1 });
  });

  it("records absent settings as null rather than as the defaults", async () => {
    expect((await service.backup(USER)).settings).toBeNull();
  });

  // Plan §5.4's acceptance criterion, verbatim.
  it("backup -> wipe -> restore reproduces identical stats", async () => {
    seedCollection(fake);
    const before = await new StatsService(fake.asPrisma()).get(USER, QUERY);

    // Pinned so the equality below has teeth: each of these would move if the document dropped a
    // column. `remainingNewToday` is 7 - 1 only because `ReviewLog.stateBefore` survived as NEW,
    // and `dueNow` is 1 only because the card came back in state REVIEW rather than NEW.
    expect(before).toMatchObject({ completed: 2, accuracy: 0.5, dueNow: 1, remainingNewToday: 6 });

    const document = await service.backup(USER);
    const wiped = new FakePrisma();
    const restored = await new BackupService(wiped.asPrisma()).restore(USER, document);

    expect(restored.restored).toEqual({ puzzles: 2, moves: 4, cards: 2, logs: 2 });
    expect(await new StatsService(wiped.asPrisma()).get(USER, QUERY)).toEqual(before);
  });

  it("round-trips a non-UTC timezone and a shifted rollover hour", async () => {
    fake.settings.push({ userId: USER, timezone: "Asia/Tokyo", dayRolloverHour: 4, newPerDay: 3, reviewsPerDay: null });

    const wiped = new FakePrisma();
    await new BackupService(wiped.asPrisma()).restore(USER, await service.backup(USER));

    expect(wiped.settings).toEqual([
      { userId: USER, timezone: "Asia/Tokyo", dayRolloverHour: 4, newPerDay: 3, reviewsPerDay: null },
    ]);
  });

  it("round-trips the document itself, solution-tree links and all", async () => {
    seedCollection(fake);
    const document = await service.backup(USER);

    const wiped = new FakePrisma();
    const restoreService = new BackupService(wiped.asPrisma());
    await restoreService.restore(USER, document);
    const again = await restoreService.backup(USER);

    expect({ ...again, exportedAt: "" }).toEqual({ ...document, exportedAt: "" });
    expect(again.moves.map((move) => [move.id, move.parentId])).toEqual([
      ["m1", null],
      ["m2", null],
      ["m3", "m2"],
      ["m4", "m3"],
    ]);
  });

  it("replaces the caller's collection rather than merging into it", async () => {
    seedCollection(fake);
    const document = await service.backup(USER);

    await service.restore(USER, document);

    expect(fake.puzzles).toHaveLength(2);
    expect(fake.reviewLogs).toHaveLength(2);
  });

  it("leaves other users' rows untouched", async () => {
    seedCollection(fake);
    const document = await service.backup(USER);
    fake.puzzles.push({ ...fake.puzzles[0]!, id: "other-p1", userId: "someone-else" });

    await service.restore(USER, document);

    expect(fake.puzzles.filter((row) => row.userId === "someone-else")).toHaveLength(1);
  });

  it("rejects a document whose rows point at ids it does not contain, before touching the database", async () => {
    seedCollection(fake);
    const document = await service.backup(USER);
    const broken: BackupDocument = {
      ...document,
      reviewLogs: document.reviewLogs.map((log) => ({ ...log, cardId: "missing-card" })),
    };

    await expect(service.restore(USER, broken)).rejects.toThrow();
    expect(fake.puzzles).toHaveLength(2);
  });
});
