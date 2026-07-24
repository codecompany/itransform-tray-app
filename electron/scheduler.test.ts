import { describe, expect, it, vi } from "vitest";
import { DailyScheduler, localDate } from "./scheduler";

describe("daily scheduler", () => {
  it("uses the computer local date", () => {
    expect(localDate(new Date(2026, 6, 23, 8, 30))).toBe("2026-07-23");
  });

  it("checks immediately and delegates the current time", async () => {
    const onDue = vi.fn();
    const current = new Date(2026, 6, 23, 8, 1);
    const scheduler = new DailyScheduler(onDue);
    await scheduler.check(current);
    expect(onDue).toHaveBeenCalledWith(current);
  });

  it("starts an interval and clears it on stop", () => {
    vi.useFakeTimers();
    const onDue = vi.fn();
    const scheduler = new DailyScheduler(onDue, 1_000);
    scheduler.start();
    expect(onDue).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(onDue).toHaveBeenCalledTimes(2);
    scheduler.stop();
    vi.advanceTimersByTime(2_000);
    expect(onDue).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("can start without an immediate tick", () => {
    vi.useFakeTimers();
    const onDue = vi.fn();
    const scheduler = new DailyScheduler(onDue, 1_000);
    scheduler.start(false);
    expect(onDue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onDue).toHaveBeenCalledOnce();
    scheduler.stop();
    vi.useRealTimers();
  });
});
