import { describe, expect, it } from "vitest";
import { parseJsonImport } from "./json";
import { primaryLineOf } from "./export";

const BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";

function puzzle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fen: BACK_RANK,
    difficulty: 2,
    themes: ["backRankMate"],
    tags: ["mate-in-1"],
    moves: [{ san: "Ra8#", actor: "SOLVER", isPrimary: true, children: [] }],
    ...overrides,
  };
}

describe("parseJsonImport", () => {
  it("reads a bare array of puzzles", () => {
    const result = parseJsonImport(JSON.stringify([puzzle()]));
    if (!result.ok) throw new Error(result.message);
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(record.candidate).toMatchObject({
      fen: BACK_RANK,
      difficulty: 2,
      themes: ["backRankMate"],
      tags: ["mate-in-1"],
    });
  });

  it("reads the {puzzles: [...]} envelope that the JSON export emits", () => {
    const result = parseJsonImport(JSON.stringify({ exportedAt: "2026-01-01", puzzles: [puzzle()] }));
    if (!result.ok) throw new Error(result.message);
    expect(result.records).toHaveLength(1);
  });

  it("preserves a branching tree, which is what JSON exists for", () => {
    const branched = puzzle({
      moves: [
        { san: "Rb1", actor: "SOLVER", isPrimary: false, children: [] },
        {
          san: "Ra8+",
          actor: "SOLVER",
          isPrimary: true,
          comment: "the main line",
          children: [{ san: "Kh7", actor: "OPPONENT", isPrimary: true, children: [] }],
        },
      ],
    });
    const result = parseJsonImport(JSON.stringify([branched]));
    if (!result.ok) throw new Error(result.message);
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(record.candidate.moves).toHaveLength(2);
    expect(record.candidate.moves[1]?.comment).toBe("the main line");
    expect(primaryLineOf(record.candidate.moves)).toEqual(["Ra8+", "Kh7"]);
  });

  it("treats a leaf's absent children as an empty subtree", () => {
    const result = parseJsonImport(
      JSON.stringify([puzzle({ moves: [{ san: "Ra8#", actor: "SOLVER", isPrimary: true }] })]),
    );
    if (!result.ok) throw new Error(result.message);
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");
    expect(record.candidate.moves[0]?.children).toEqual([]);
  });

  it("defaults absent themes and tags to empty arrays", () => {
    const bare = { fen: BACK_RANK, difficulty: 1, moves: [{ san: "Ra8#", actor: "SOLVER", isPrimary: true, children: [] }] };
    const result = parseJsonImport(JSON.stringify([bare]));
    if (!result.ok) throw new Error(result.message);
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");
    expect(record.candidate).toMatchObject({ themes: [], tags: [] });
  });

  it("rejects malformed records one by one without aborting the batch", () => {
    const result = parseJsonImport(
      JSON.stringify([
        puzzle(),
        puzzle({ fen: "" }),
        puzzle({ difficulty: 9 }),
        puzzle({ moves: [] }),
        puzzle({ moves: [{ san: "Ra8#", actor: "KING", isPrimary: true, children: [] }] }),
        "not an object",
      ]),
    );
    if (!result.ok) throw new Error(result.message);

    expect(result.records.map((record) => record.ok)).toEqual([true, false, false, false, false, false]);
    expect(result.records.map((record) => record.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("fails the whole file on unparseable JSON", () => {
    const result = parseJsonImport("{not json");
    expect(result.ok).toBe(false);
  });

  it("fails the whole file when the top level is neither an array nor an envelope", () => {
    expect(parseJsonImport(JSON.stringify({ rows: [] }))).toMatchObject({ ok: false });
  });
});
