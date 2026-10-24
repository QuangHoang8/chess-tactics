import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StatsResponse } from "@chess-tactics/contracts";
import { StatsPage } from "./StatsPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function statsWith(groupKey: string): StatsResponse {
  return {
    completed: 1,
    accuracy: 1,
    dueNow: 0,
    remainingNewToday: 20,
    groups: [{ key: groupKey, count: 1, accuracy: 1 }],
    history: [],
  };
}

/** Resolves `groupBy=difficulty` slowly and `groupBy=theme` quickly, so a difficulty request can
 * still be in flight after the user has already switched back to themes. */
function respondOutOfOrder(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const slow = String(input).includes("groupBy=difficulty");
    const body = statsWith(slow ? "5" : "backRankMate");

    return new Promise((resolve) =>
      setTimeout(
        () => resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response),
        slow ? 150 : 5,
      ),
    );
  });
}

function firstGroupKey(container: HTMLElement): string | undefined {
  return container.querySelector("tbody td")?.textContent ?? undefined;
}

async function selectGroupBy(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("StatsPage", () => {
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (container) {
      container.remove();
      container = null;
    }
    vi.restoreAllMocks();
  });

  it("ignores a superseded response, so the table cannot disagree with the grouping control", async () => {
    respondOutOfOrder();

    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <StatsPage />
        </StrictMode>,
      );
    });
    await settle(50);

    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    expect(firstGroupKey(container)).toBe("backRankMate");

    // Ask for difficulty, then change our mind before that slow response lands.
    await selectGroupBy(select!, "difficulty");
    await selectGroupBy(select!, "theme");

    // Long enough for the abandoned difficulty response to arrive last.
    await settle(300);

    expect(select!.value).toBe("theme");
    expect(firstGroupKey(container)).toBe("backRankMate");

    root.unmount();
  });
});
