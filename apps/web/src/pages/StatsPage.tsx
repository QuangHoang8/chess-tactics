import { useEffect, useState } from "react";
import type { StatsQuery, StatsResponse } from "@chess-tactics/contracts";
import { ApiError, getStats } from "../api/client";

type Status = "loading" | "ready" | "error";
type GroupBy = StatsQuery["groupBy"];

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function StatsPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("theme");

  useEffect(() => {
    setStatus("loading");
    getStats({ groupBy })
      .then((result) => {
        if (!result) {
          return;
        }
        setStats(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof ApiError ? error.message : "Failed to load stats");
        setStatus("error");
      });
  }, [groupBy]);

  if (status === "error") {
    return (
      <main className="stats-page">
        <p role="alert">{errorMessage}</p>
      </main>
    );
  }
  if (!stats) {
    return (
      <main className="stats-page">
        <p>Loading...</p>
      </main>
    );
  }

  // Only days with activity are listed; the series itself carries every day in the window, which
  // is what a chart would want but what a table would mostly fill with zeroes.
  const activeDays = stats.history.filter((point) => point.reviews > 0);

  return (
    <main className="stats-page">
      <h1>Progress</h1>

      <dl>
        <dt>Reviews completed</dt>
        <dd>{stats.completed}</dd>
        <dt>Accuracy</dt>
        <dd>{percent(stats.accuracy)}</dd>
        <dt>Due now</dt>
        <dd>{stats.dueNow}</dd>
        <dt>New remaining today</dt>
        <dd>{stats.remainingNewToday}</dd>
      </dl>

      <h2>Breakdown</h2>
      <label>
        Group by
        <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as GroupBy)}>
          <option value="theme">Theme</option>
          <option value="difficulty">Difficulty</option>
        </select>
      </label>

      {stats.groups.length === 0 ? (
        <p>No reviews in this window yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{groupBy === "theme" ? "Theme" : "Difficulty"}</th>
              <th>Reviews</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {stats.groups.map((group) => (
              <tr key={group.key}>
                <td>{group.key}</td>
                <td>{group.count}</td>
                <td>{percent(group.accuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>History</h2>
      {activeDays.length === 0 ? (
        <p>No reviews in the last 30 days.</p>
      ) : (
        <ul>
          {activeDays.map((point) => (
            <li key={point.date}>
              {point.date} -- {point.reviews} reviews, {percent(point.accuracy)} accuracy
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
