import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, formatCsvRow, parseCsv, parseCsvImport } from "./csv";
import { CSV_HEADER_ROW, primaryLineOf, puzzleToCsvRow } from "./export";

const HEADER = CSV_COLUMNS.join(",");
const BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";

describe("parseCsv", () => {
  it("reads quoted fields containing commas, quotes and newlines", () => {
    const rows = parseCsv('a,"b,c","d""e"\n"line\n2",f,g\n');
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["line\n2", "f", "g"],
    ]);
  });

  it("reads a CRLF file and drops blank lines", () => {
    expect(parseCsv("a,b\r\n\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("round-trips through formatCsvRow", () => {
    const cells = ["plain", 'has "quotes"', "has,comma", "has\nnewline"];
    expect(parseCsv(formatCsvRow(cells))).toEqual([cells]);
  });
});

describe("parseCsvImport", () => {
  it("reads a row into a linear alternating solution tree", () => {
    const result = parseCsvImport(`${HEADER}\n${BACK_RANK},2,backRankMate mate,mate-in-1,Book,"Rook to a8, mate",Ra8#`);
    if (!result.ok) throw new Error(result.message);

    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");
    expect(record.candidate).toMatchObject({
      fen: BACK_RANK,
      difficulty: 2,
      themes: ["backRankMate", "mate"],
      tags: ["mate-in-1"],
      source: "Book",
      explanation: "Rook to a8, mate",
    });
    expect(record.candidate.moves[0]?.actor).toBe("SOLVER");
  });

  it("alternates actors across a multi-ply solution", () => {
    const result = parseCsvImport(`${HEADER}\n${BACK_RANK},1,,,,,Ra8+ Kh7 Ra7`);
    if (!result.ok) throw new Error(result.message);
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(primaryLineOf(record.candidate.moves)).toEqual(["Ra8+", "Kh7", "Ra7"]);
    expect(record.candidate.moves[0]?.children[0]?.actor).toBe("OPPONENT");
  });

  it("accepts columns in any order and ignores header case", () => {
    const result = parseCsvImport(`SOLUTION,Difficulty,FEN,themes,tags\nRa8#,2,${BACK_RANK},,`);
    if (!result.ok) throw new Error(result.message);
    expect(result.records[0]).toMatchObject({ ok: true });
  });

  it("rejects one bad row per record without aborting the file", () => {
    const result = parseCsvImport(
      [HEADER, `${BACK_RANK},2,,,,,Ra8#`, `,2,,,,,Ra8#`, `${BACK_RANK},9,,,,,Ra8#`, `${BACK_RANK},2,,,,,`].join("\n"),
    );
    if (!result.ok) throw new Error(result.message);

    expect(result.records.map((record) => record.ok)).toEqual([true, false, false, false]);
    expect(result.records.map((record) => record.index)).toEqual([0, 1, 2, 3]);
  });

  it("fails the whole file when a required column is missing", () => {
    expect(parseCsvImport("fen,difficulty\nx,1")).toEqual({
      ok: false,
      message: "CSV header is missing required column(s): themes, tags, solution",
    });
  });

  it("fails an empty file", () => {
    expect(parseCsvImport("")).toEqual({ ok: false, message: "CSV file is empty" });
  });
});

describe("puzzleToCsvRow", () => {
  it("emits the documented column order under the exported header", () => {
    const row = puzzleToCsvRow({
      fen: BACK_RANK,
      difficulty: 2,
      themes: ["backRankMate"],
      tags: ["mate-in-1"],
      source: "Book",
      explanation: "Rook to a8, mate",
      moves: [{ san: "Ra8#", actor: "SOLVER", isPrimary: true, children: [] }],
    });

    expect(CSV_HEADER_ROW).toBe(HEADER);
    expect(parseCsv(`${CSV_HEADER_ROW}\n${row}`)[1]).toEqual([
      BACK_RANK,
      "2",
      "backRankMate",
      "mate-in-1",
      "Book",
      "Rook to a8, mate",
      "Ra8#",
    ]);
  });

  it("flattens a branched puzzle to its primary line, because CSV has no room for the tree", () => {
    const row = puzzleToCsvRow({
      fen: BACK_RANK,
      difficulty: 1,
      themes: [],
      tags: [],
      moves: [
        { san: "Rb1", actor: "SOLVER", isPrimary: false, children: [] },
        {
          san: "Ra8+",
          actor: "SOLVER",
          isPrimary: true,
          children: [{ san: "Kh7", actor: "OPPONENT", isPrimary: true, children: [] }],
        },
      ],
    });

    expect(parseCsv(row)[0]?.[6]).toBe("Ra8+ Kh7");
  });

  it("re-imports its own export", () => {
    const puzzle = {
      fen: BACK_RANK,
      difficulty: 3,
      themes: ["backRankMate"],
      tags: [],
      explanation: 'He said "mate", then left',
      moves: [{ san: "Ra8#", actor: "SOLVER" as const, isPrimary: true, children: [] }],
    };
    const result = parseCsvImport(`${CSV_HEADER_ROW}\n${puzzleToCsvRow(puzzle)}`);
    if (!result.ok) throw new Error(result.message);
    const [record] = result.records;
    if (!record?.ok) throw new Error("expected an accepted record");

    expect(record.candidate).toMatchObject({
      fen: puzzle.fen,
      difficulty: 3,
      themes: ["backRankMate"],
      explanation: 'He said "mate", then left',
    });
  });
});
