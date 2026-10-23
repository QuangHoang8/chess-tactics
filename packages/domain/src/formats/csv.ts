import type { SolutionTreeInput } from "../chess/types";
import type { ParseResult, ParsedRecord } from "./types";

/**
 * The flat CSV column set (plan §5 3.2), shared by import and export so the two cannot drift.
 * Documented in docs/formats.md.
 */
export const CSV_COLUMNS = [
  "fen",
  "difficulty",
  "themes",
  "tags",
  "source",
  "explanation",
  "solution",
] as const;

/** RFC 4180: fields may be quoted, and a quote inside a quoted field is doubled. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = (): void => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  const normalised = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < normalised.length; i += 1) {
    const char = normalised[i];
    if (quoted) {
      if (char === '"') {
        if (normalised[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
    }
  }

  if (started || field !== "" || row.length > 0) {
    endRow();
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export function formatCsvRow(cells: readonly string[]): string {
  return cells.map(formatCsvCell).join(",");
}

function formatCsvCell(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * Parses the flat CSV format. Each row carries one linear alternating line as space-separated
 * SAN -- CSV cannot express the §3.3 move *tree* (alternatives or branching opponent replies);
 * JSON is the format for those. docs/formats.md states this limit.
 */
export function parseCsvImport(text: string): ParseResult {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) {
    return { ok: false, message: "CSV file is empty" };
  }

  const columnIndex = new Map(header.map((name, i) => [name.trim().toLowerCase(), i]));
  const missing = CSV_COLUMNS.filter(
    (name) => name !== "source" && name !== "explanation" && !columnIndex.has(name),
  );
  if (missing.length > 0) {
    return { ok: false, message: `CSV header is missing required column(s): ${missing.join(", ")}` };
  }

  return {
    ok: true,
    records: rows.slice(1).map((cells, index) => toRecord(cells, columnIndex, index)),
  };
}

function toRecord(
  cells: string[],
  columnIndex: Map<string, number>,
  index: number,
): ParsedRecord {
  const cell = (name: string): string => {
    const at = columnIndex.get(name);
    return at === undefined ? "" : (cells[at] ?? "").trim();
  };

  const fen = cell("fen");
  if (fen === "") {
    return { index, ok: false, message: "Missing fen" };
  }

  const difficulty = Number(cell("difficulty"));
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    return { index, ok: false, message: `difficulty must be an integer 1-5, got "${cell("difficulty")}"` };
  }

  const sans = cell("solution").split(/\s+/).filter((san) => san !== "");
  if (sans.length === 0) {
    return { index, ok: false, message: "Missing solution" };
  }

  const source = cell("source");
  const explanation = cell("explanation");

  return {
    index,
    ok: true,
    candidate: {
      fen,
      difficulty,
      themes: splitList(cell("themes")),
      tags: splitList(cell("tags")),
      ...(source !== "" ? { source } : {}),
      ...(explanation !== "" ? { explanation } : {}),
      moves: linearTree(sans, 0),
      notes: [],
    },
  };
}

/** Themes and tags are space-separated inside their cell, so they cannot contain spaces. */
function splitList(cell: string): string[] {
  return cell.split(/\s+/).filter((item) => item !== "");
}

function linearTree(sans: string[], depth: number): SolutionTreeInput[] {
  const san = sans[depth];
  if (san === undefined) {
    return [];
  }
  return [
    {
      san,
      actor: depth % 2 === 0 ? "SOLVER" : "OPPONENT",
      isPrimary: true,
      children: linearTree(sans, depth + 1),
    },
  ];
}
