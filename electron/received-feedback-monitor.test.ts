import { describe, expect, it, vi } from "vitest";
import type { FeedbackHistoryItem } from "../src/contracts";
import { ReceivedFeedbackMonitor } from "./received-feedback-monitor";

function feedback(id: string): FeedbackHistoryItem {
  return {
    id,
    person: "Colaborador",
    date: "2026-07-24T12:00:00Z",
    importance: 4,
    method: "legacy",
    content: {
      context: "",
      observedBehavior: "",
      perceivedImpact: "",
      suggestedNextStep: "",
      continueDoing: "",
      startDoing: "",
      stopDoing: ""
    },
    message: "Feedback"
  };
}

describe("ReceivedFeedbackMonitor", () => {
  it("uses the first load as a baseline and reports only new feedbacks", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce([feedback("old")])
      .mockResolvedValueOnce([feedback("new"), feedback("old")]);
    const onReceived = vi.fn();
    const monitor = new ReceivedFeedbackMonitor(load, onReceived, 1_000);

    await monitor.check(new Date(1_000));
    expect(onReceived).not.toHaveBeenCalled();
    await monitor.check(new Date(2_000));
    expect(onReceived).toHaveBeenCalledWith([
      expect.objectContaining({ id: "new" })
    ]);
  });

  it("does not poll again before its interval", async () => {
    const load = vi.fn().mockResolvedValue([]);
    const monitor = new ReceivedFeedbackMonitor(load, vi.fn(), 1_000);

    await monitor.check(new Date(1_000));
    await monitor.check(new Date(1_999));
    expect(load).toHaveBeenCalledOnce();
  });

  it("persists its baseline and detects feedback received while the app was closed", async () => {
    const persist = vi.fn();
    const first = new ReceivedFeedbackMonitor(
      vi.fn().mockResolvedValue([]),
      vi.fn(),
      1_000,
      persist
    );
    await first.check(new Date(1_000));
    expect(first.snapshot()).toEqual([]);
    expect(persist).toHaveBeenCalledWith([]);

    const onReceived = vi.fn();
    const reopened = new ReceivedFeedbackMonitor(
      vi.fn().mockResolvedValue([feedback("while-closed")]),
      onReceived,
      1_000
    );
    reopened.hydrate(first.snapshot());
    await reopened.check(new Date(2_000));

    expect(onReceived).toHaveBeenCalledWith([
      expect.objectContaining({ id: "while-closed" })
    ]);
  });

  it("retains the most recent 500 IDs in the order returned by history", async () => {
    const items = Array.from({ length: 510 }, (_, index) => feedback(`feedback-${index}`));
    const monitor = new ReceivedFeedbackMonitor(
      vi.fn().mockResolvedValue(items),
      vi.fn()
    );

    await monitor.check();

    expect(monitor.snapshot()).toHaveLength(500);
    expect(monitor.snapshot()?.[0]).toBe("feedback-0");
    expect(monitor.snapshot()).not.toContain("feedback-509");
  });
});
