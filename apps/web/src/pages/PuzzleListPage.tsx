import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PuzzleSummary } from "@chess-tactics/contracts";
import { ApiError, deletePuzzle, listPuzzles } from "../api/client";

type Status = "loading" | "ready" | "error";

export function PuzzleListPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<PuzzleSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    listPuzzles()
      .then((result) => {
        if (!result) {
          return;
        }
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof ApiError ? error.message : "Failed to load puzzles");
        setStatus("error");
      });
  }, []);

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await listPuzzles(nextCursor);
      if (result) {
        setItems((prev) => [...prev, ...result.items]);
        setNextCursor(result.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Delete this puzzle? This cannot be undone.")) {
      return;
    }
    setDeleteError(null);
    try {
      await deletePuzzle(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : "Failed to delete puzzle");
    }
  }

  if (status === "loading") {
    return (
      <main className="puzzle-list-page">
        <p>Loading...</p>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="puzzle-list-page">
        <p role="alert">{errorMessage}</p>
      </main>
    );
  }

  return (
    <main className="puzzle-list-page">
      <h1>Puzzles</h1>
      <Link to="/puzzles/new">New puzzle</Link>
      {deleteError && <p role="alert">{deleteError}</p>}

      <ul>
        {items.map((puzzle) => (
          <li key={puzzle.id}>
            <code>{puzzle.fen}</code> -- difficulty {puzzle.difficulty}
            {puzzle.themes.length > 0 && ` -- ${puzzle.themes.join(", ")}`}
            <Link to={`/puzzles/${puzzle.id}/edit`}>Edit</Link>
            <button type="button" onClick={() => void handleDelete(puzzle.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p>No puzzles yet.</p>}

      {nextCursor && (
        <button type="button" disabled={loadingMore} onClick={() => void handleLoadMore()}>
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </main>
  );
}
