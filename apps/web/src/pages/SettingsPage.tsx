import { useEffect, useState } from "react";
import type { UserSettings } from "@chess-tactics/contracts";
import { ApiError, downloadBackup, getSettings, restoreBackup, updateSettings } from "../api/client";

const ROLLOVER_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** `reviewsPerDay: null` is "unlimited" (plan §12), which a number input cannot express -- the
 * checkbox owns that distinction and the input is only consulted when the cap is on. */
interface Draft {
  timezone: string;
  dayRolloverHour: number;
  newPerDay: number;
  capReviews: boolean;
  reviewsPerDay: number;
}

function toDraft(settings: UserSettings): Draft {
  return {
    timezone: settings.timezone,
    dayRolloverHour: settings.dayRolloverHour,
    newPerDay: settings.newPerDay,
    capReviews: settings.reviewsPerDay !== null,
    reviewsPerDay: settings.reviewsPerDay ?? 50,
  };
}

export function SettingsPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        if (settings) {
          setDraft(toDraft(settings));
        }
      })
      .catch((caught: unknown) => {
        setLoadError(caught instanceof ApiError ? caught.message : "Failed to load settings");
      });
  }, []);

  function patch(changes: Partial<Draft>): void {
    setDraft((previous) => (previous ? { ...previous, ...changes } : previous));
  }

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function handleSave(): void {
    if (!draft) {
      return;
    }
    void run(async () => {
      const saved = await updateSettings({
        timezone: draft.timezone,
        dayRolloverHour: draft.dayRolloverHour,
        newPerDay: draft.newPerDay,
        reviewsPerDay: draft.capReviews ? draft.reviewsPerDay : null,
      });
      if (saved) {
        setDraft(toDraft(saved));
      }
      return "Settings saved.";
    });
  }

  function handleBackup(): void {
    void run(async () => {
      await downloadBackup("chess-tactics-backup.json");
      return "Backup downloaded.";
    });
  }

  function handleRestore(file: File): void {
    void run(async () => {
      const text = await file.text();
      try {
        JSON.parse(text);
      } catch {
        throw new ApiError(422, `${file.name} is not valid JSON`);
      }

      const result = await restoreBackup(text);
      const restored = result?.restored;
      if (!restored) {
        return "Restored.";
      }

      const reloaded = await getSettings();
      if (reloaded) {
        setDraft(toDraft(reloaded));
      }
      return `Restored ${restored.puzzles} puzzles, ${restored.cards} cards and ${restored.logs} review logs.`;
    });
  }

  if (loadError) {
    return (
      <main className="settings-page">
        <p role="alert">{loadError}</p>
      </main>
    );
  }
  if (!draft) {
    return (
      <main className="settings-page">
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main className="settings-page">
      <h1>Settings</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <label>
        Timezone
        <input
          type="text"
          value={draft.timezone}
          onChange={(event) => patch({ timezone: event.target.value })}
        />
      </label>

      <label>
        Day starts at
        <select
          value={draft.dayRolloverHour}
          onChange={(event) => patch({ dayRolloverHour: Number(event.target.value) })}
        >
          {ROLLOVER_HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {String(hour).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </label>

      <label>
        New puzzles per day
        <input
          type="number"
          min={0}
          value={draft.newPerDay}
          onChange={(event) => patch({ newPerDay: Number(event.target.value) })}
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={draft.capReviews}
          onChange={(event) => patch({ capReviews: event.target.checked })}
        />
        Cap reviews per day
      </label>
      {draft.capReviews && (
        <label>
          Reviews per day
          <input
            type="number"
            min={0}
            value={draft.reviewsPerDay}
            onChange={(event) => patch({ reviewsPerDay: Number(event.target.value) })}
          />
        </label>
      )}

      <button type="button" disabled={busy} onClick={handleSave}>
        {busy ? "Working..." : "Save settings"}
      </button>

      <h2>Backup and restore</h2>
      <p>
        The backup file holds every puzzle, card and review log. Restoring <strong>replaces</strong>{" "}
        everything currently stored for this account.
      </p>
      <button type="button" disabled={busy} onClick={handleBackup}>
        Download backup
      </button>
      <label>
        Restore from backup
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && window.confirm("Replace all stored puzzles and progress with this backup?")) {
              handleRestore(file);
            }
            event.target.value = "";
          }}
        />
      </label>
    </main>
  );
}
