import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./async";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("returns the operation result and clears its fallback timer", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("ok"), "demorou", 100)).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a stalled operation with an actionable message", async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<never>(() => undefined), "Tente novamente.", 100);
    const rejection = expect(result).rejects.toThrow("Tente novamente.");
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});
