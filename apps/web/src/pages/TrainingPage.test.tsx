import { act } from "react";
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TrainingPage } from "./TrainingPage";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe("TrainingPage under StrictMode", () => {
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

  it("leaves the loading state instead of hanging forever (StrictMode double-invokes effects)", async () => {
    // React 18+ StrictMode runs effect setup -> cleanup -> setup in dev. A naive "unmounted" ref
    // that isn't reset at the start of the effect gets permanently poisoned by the first
    // (discarded) cleanup, so every later state update -- including the one that leaves the
    // "loading" screen -- silently no-ops. This regression test pins that fix.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable in test"));

    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <TrainingPage />
        </StrictMode>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).not.toContain("Loading");
    root.unmount();
  });
});
