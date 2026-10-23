import { useState } from "react";
import type {
  ExportPuzzlesQuery,
  ImportBatchResponse,
  ImportKindValue,
  ImportRecord,
  PgnImportModeValue,
} from "@chess-tactics/contracts";
import { ApiError, commitImport, downloadExport, previewImport } from "../api/client";

const KINDS: ImportKindValue[] = ["JSON", "CSV", "PGN"];

/** Chosen from the file name so the common case needs no thought; still overridable. */
function kindOf(file: File): ImportKindValue {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "pgn" ? "PGN" : extension === "csv" ? "CSV" : "JSON";
}

function parsePlies(input: string): number[] {
  return input
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((ply) => Number.isInteger(ply) && ply >= 0);
}

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ImportKindValue>("JSON");
  const [mode, setMode] = useState<PgnImportModeValue>("WHOLE_GAME");
  const [pliesInput, setPliesInput] = useState("");

  const [batch, setBatch] = useState<ImportBatchResponse | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const [exportFormat, setExportFormat] = useState<ExportPuzzlesQuery["format"]>("json");
  const [includeCards, setIncludeCards] = useState(false);
  const [includeReviews, setIncludeReviews] = useState(false);

  function chooseFile(chosen: File | null): void {
    setFile(chosen);
    setBatch(null);
    setResult(null);
    setError(null);
    if (chosen) {
      setKind(kindOf(chosen));
    }
  }

  async function handlePreview(): Promise<void> {
    if (!file) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const plies = parsePlies(pliesInput);
      const preview = await previewImport(
        {
          file,
          kind,
          ...(kind === "PGN" ? { mode } : {}),
          ...(kind === "PGN" && mode === "EXTRACT_PLIES" ? { plies } : {}),
        },
        crypto.randomUUID(),
      );
      setBatch(preview);
      // Anything that will not become a puzzle starts out skipped, so the default commit is
      // exactly what the preview promised.
      setSkipped(
        new Set(
          (preview?.report ?? [])
            .filter((record) => record.status !== "ACCEPTED")
            .map((record) => record.index),
        ),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit(): Promise<void> {
    if (!batch) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const committed = await commitImport(batch.batchId, [...skipped]);
      setResult(
        committed
          ? `Created ${String(committed.created)} puzzle(s); skipped ${String(committed.skipped)}.`
          : null,
      );
      setBatch(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await downloadExport({ format: exportFormat, includeCards, includeReviews });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleSkip(index: number): void {
    setSkipped((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  const willCreate = (batch?.report ?? []).filter(
    (record) => record.status === "ACCEPTED" && !skipped.has(record.index),
  ).length;

  return (
    <main className="import-page">
      <h1>Import</h1>

      <section>
        <label>
          File
          <input
            type="file"
            accept=".json,.csv,.pgn,.txt"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <label>
          Format
          <select value={kind} onChange={(event) => setKind(event.target.value as ImportKindValue)}>
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        {kind === "PGN" && (
          <fieldset>
            <legend>PGN mode</legend>
            <label>
              <input
                type="radio"
                name="pgn-mode"
                value="WHOLE_GAME"
                checked={mode === "WHOLE_GAME"}
                onChange={() => setMode("WHOLE_GAME")}
              />
              Whole game &mdash; one puzzle per game, from its own starting position
            </label>
            <label>
              <input
                type="radio"
                name="pgn-mode"
                value="EXTRACT_PLIES"
                checked={mode === "EXTRACT_PLIES"}
                onChange={() => setMode("EXTRACT_PLIES")}
              />
              Extract plies &mdash; one puzzle per selected position in each game
            </label>
            {mode === "EXTRACT_PLIES" && (
              <label>
                Plies (zero-based, comma separated)
                <input
                  type="text"
                  value={pliesInput}
                  placeholder="e.g. 12, 18, 24"
                  onChange={(event) => setPliesInput(event.target.value)}
                />
              </label>
            )}
            <p>Variations are not imported; chess.js reads the mainline only.</p>
          </fieldset>
        )}

        <button
          type="button"
          disabled={!file || busy || (kind === "PGN" && mode === "EXTRACT_PLIES" && parsePlies(pliesInput).length === 0)}
          onClick={() => void handlePreview()}
        >
          {busy ? "Working..." : "Preview"}
        </button>
      </section>

      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}

      {batch && (
        <section>
          <h2>Preview</h2>
          <p>
            {batch.totalRows} record(s): {batch.acceptedRows} accepted, {batch.rejectedRows} not.
            Nothing has been saved yet.
          </p>

          <table>
            <thead>
              <tr>
                <th scope="col">Import</th>
                <th scope="col">#</th>
                <th scope="col">Status</th>
                <th scope="col">Position</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {batch.report.map((record) => (
                <PreviewRow
                  key={record.index}
                  record={record}
                  skipped={skipped.has(record.index)}
                  onToggle={() => toggleSkip(record.index)}
                />
              ))}
            </tbody>
          </table>

          <button type="button" disabled={busy || willCreate === 0} onClick={() => void handleCommit()}>
            {busy ? "Working..." : `Import ${String(willCreate)} puzzle(s)`}
          </button>
        </section>
      )}

      <section>
        <h2>Export</h2>
        <label>
          Format
          <select
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as ExportPuzzlesQuery["format"])}
          >
            <option value="json">JSON (keeps alternatives and branches)</option>
            <option value="csv">CSV (primary line only)</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeCards}
            onChange={(event) => setIncludeCards(event.target.checked)}
          />
          Include scheduling state
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeReviews}
            disabled={exportFormat === "csv"}
            onChange={(event) => setIncludeReviews(event.target.checked)}
          />
          Include review history {exportFormat === "csv" && "(JSON only)"}
        </label>
        <button type="button" disabled={busy} onClick={() => void handleExport()}>
          Export
        </button>
      </section>
    </main>
  );
}

function PreviewRow({
  record,
  skipped,
  onToggle,
}: {
  record: ImportRecord;
  skipped: boolean;
  onToggle: () => void;
}) {
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={!skipped}
          // Only an accepted record can be created; unticking the rest changes nothing.
          disabled={record.status !== "ACCEPTED"}
          aria-label={`Import record ${String(record.index)}`}
          onChange={onToggle}
        />
      </td>
      <td>{record.index}</td>
      <td>{record.status}</td>
      <td>
        <code>{record.fen ?? "--"}</code>
      </td>
      <td>{record.message ?? ""}</td>
    </tr>
  );
}
