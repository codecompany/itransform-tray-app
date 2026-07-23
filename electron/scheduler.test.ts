import { describe, expect, it, vi } from "vitest";
import { DailyScheduler, isDailyQuestionDue, localDate } from "./scheduler";

describe("daily scheduler", () => {
  it("uses the computer local date", () => {
    expect(localDate(new Date(2026, 6, 23, 8, 30))).toBe("2026-07-23");
  });

  it("becomes due at the configured time and stops after the daily answer", () => {
    const now = new Date(2026, 6, 23, 9, 0);
    expect(isDailyQuestionDue(now, "09:00")).toBe(true);
    expect(isDailyQuestionDue(now, "09:01")).toBe(false);
    expect(isDailyQuestionDue(now, "09:00", "2026-07-23")).toBe(false);
    expect(isDailyQuestionDue(now, "25:00")).toBe(false);
  });

  it("checks immediately and delegates a due question", async () => {
    const onDue = vi.fn();
    const scheduler = new DailyScheduler(() => ({ time: "08:00" }), onDue);
    await scheduler.check(new Date(2026, 6, 23, 8, 1));
    expect(onDue).toHaveBeenCalledOnce();
  });

  it("starts an interval and clears it on stop", () => {
    vi.useFakeTimers();
    const onDue = vi.fn();
    const scheduler = new DailyScheduler(() => ({ time: "00:00" }), onDue, 1_000);
    scheduler.start();
    expect(onDue).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(onDue).toHaveBeenCalledTimes(2);
    scheduler.stop();
    vi.advanceTimersByTime(2_000);
    expect(onDue).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does nothing when no time is configured", async () => {
    const onDue = vi.fn();
    const scheduler = new DailyScheduler(() => ({}), onDue);
    await scheduler.check(new Date(2026, 6, 23, 12, 0));
    expect(onDue).not.toHaveBeenCalled();
  });
});
