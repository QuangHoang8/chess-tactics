import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { validateSolution } from "@chess-tactics/domain";
import type { PuzzleWarning } from "@chess-tactics/contracts";
import { ApiError, createPuzzle, getPuzzle, updatePuzzle } from "../api/client";
import { PositionEditor } from "../components/PositionEditor";
import { SolutionTreeEditor } from "../components/SolutionTreeEditor";
import { EMPTY_BOARD_FEN, assembleTree, hydrateNodes, type EditorNode } from "../lib/chess-ui";

type LoadStatus = "loading" | "ready" | "error";

function parseList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function PuzzleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = id !== undefined;

  const [status, setStatus] = useState<LoadStatus>(isEditMode ? "loading" : "ready");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirmedFen, setConfirmedFen] = useState<string | null>(null);
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [difficulty, setDifficulty] = useState(1);
  const [themesText, setThemesText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [source, setSource] = useState("");
  const [explanation, setExplanation] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [savedWarnings, setSavedWarnings] = useState<PuzzleWarning[] | null>(null);

  useEffect(() => {
    if (!isEditMode || !id) {
      return;
    }
    let cancelled = false;
    getPuzzle(id)
      .then((puzzle) => {
        if (cancelled || !puzzle) {
          return;
        }
        setConfirmedFen(puzzle.fen);
        setNodes(hydrateNodes(puzzle.moves, puzzle.fen));
        setDifficulty(puzzle.difficulty);
        setThemesText(puzzle.themes.join(", "));
        setTagsText(puzzle.tags.join(", "));
        setSource(puzzle.source ?? "");
        setExplanation(puzzle.explanation ?? "");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Failed to load puzzle");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isEditMode, id]);

  const validation = useMemo(() => {
    if (!confirmedFen) {
      return null;
    }
    return validateSolution(confirmedFen, assembleTree(nodes));
  }, [confirmedFen, nodes]);

  function handleUnlockPosition(): void {
    if (nodes.length > 0 && !window.confirm("This clears the solution you've built so far. Continue?")) {
      return;
    }
    setNodes([]);
  }

  async function handleSubmit(): Promise<void> {
    if (!confirmedFen) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      fen: confirmedFen,
      difficulty,
      themes: parseList(themesText),
      tags: parseList(tagsText),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
      moves: assembleTree(nodes),
    };
    try {
      const result = isEditMode && id ? await updatePuzzle(id, payload) : await createPuzzle(payload);
      if (!result) {
        return;
      }
      if (result.coverageWarnings.length > 0) {
        // Plan §2.3: the authoritative, post-validation warnings from the server -- shown before
        // leaving the page, not just the client-side preview computed from local state.
        setSavedWarnings(result.coverageWarnings);
        return;
      }
      navigate("/puzzles");
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error : new ApiError(0, "Something went wrong saving this puzzle"));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="puzzle-editor-page">
        <p>Loading...</p>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="puzzle-editor-page">
        <p role="alert">{loadError}</p>
      </main>
    );
  }

  return (
    <main className="puzzle-editor-page">
      <h1>{isEditMode ? "Edit puzzle" : "New puzzle"}</h1>

      <PositionEditor
        // PositionEditor seeds its internal board/FEN state from `initialFen` only once, at
        // mount. `confirmedFen` changing (loading a different puzzle) must force a remount, and
        // so must `locked` flipping false->true on unlock -- that transition leaves
        // `confirmedFen` unchanged, so it alone wouldn't be a new key, but the user expects the
        // now-unlocked editor to show the position they just unlocked, not a stale mount.
        key={`${confirmedFen ?? "new"}-${nodes.length > 0}`}
        initialFen={confirmedFen ?? EMPTY_BOARD_FEN}
        locked={nodes.length > 0}
        onConfirm={setConfirmedFen}
        onUnlock={handleUnlockPosition}
      />

      {confirmedFen && (
        <>
          <SolutionTreeEditor rootFen={confirmedFen} nodes={nodes} onNodesChange={setNodes} />

          {validation && !validation.ok && (
            <div role="alert">
              <p>Fix these before saving:</p>
              <ul>
                {validation.errors.map((e, i) => (
                  <li key={i}>
                    Ply {e.ply}: {e.input} -- {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {validation && validation.ok && validation.warnings.length > 0 && (
            <div>
              <p>Warnings:</p>
              <ul>
                {validation.warnings.map((w, i) => (
                  <li key={i}>
                    {w.type === "uncovered_opponent_reply"
                      ? `Ply ${w.ply}: opponent reply(ies) not covered -- ${w.missingReplies.join(", ")}`
                      : `Ply ${w.ply}: ${w.reason}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset>
            <legend>Puzzle details</legend>
            <label>
              Difficulty
              <select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Themes (comma-separated)
              <input type="text" value={themesText} onChange={(event) => setThemesText(event.target.value)} />
            </label>
            <label>
              Tags (comma-separated)
              <input type="text" value={tagsText} onChange={(event) => setTagsText(event.target.value)} />
            </label>
            <label>
              Source
              <input type="text" value={source} onChange={(event) => setSource(event.target.value)} />
            </label>
            <label>
              Explanation
              <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} />
            </label>
          </fieldset>

          {submitError && (
            <div role="alert">
              <p>{submitError.message}</p>
              {submitError.details && (
                <ul>
                  {submitError.details.map((d, i) => (
                    <li key={i}>
                      {d.path}: {d.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {savedWarnings ? (
            <div>
              <p>Saved, but the server flagged these -- review before leaving:</p>
              <ul>
                {savedWarnings.map((w, i) => (
                  <li key={i}>
                    {w.type === "uncovered_opponent_reply"
                      ? `Ply ${w.ply}: opponent reply(ies) not covered -- ${w.missingReplies.join(", ")}`
                      : `Ply ${w.ply}: ${w.reason}`}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => navigate("/puzzles")}>
                Continue to puzzle list
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting || !validation?.ok}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Saving..." : "Save puzzle"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
