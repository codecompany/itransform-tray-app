import { describe, expect, it } from "vitest";
import { normalizeQuietHours, quietUntil, validateQuietHours } from "./quiet-hours";

describe("quiet hours", () => {
  it("normalizes, sorts and deduplicates persisted windows", () => {
    expect(normalizeQuietHours([
      { start: "22:00", end: "07:00" },
      { start: "12:00", end: "13:00" },
      { start: "22:00", end: "07:00" },
      { start: "bad", end: "13:00" }
    ])).toEqual([
      { start: "12:00", end: "13:00" },
      { start: "22:00", end: "07:00" }
    ]);
  });

  it("rejects incomplete and zero-length windows", () => {
    expect(() => validateQuietHours([{ start: "09:00", end: "09:00" }]))
      .toThrow("horários válidos");
    expect(() => validateQuietHours([{ start: "9:00", end: "10:00" }]))
      .toThrow("horários válidos");
  });

  it("validates a complete list and enforces the local limit", () => {
    expect(validateQuietHours([
      { start: "22:00", end: "07:00" },
      { start: "12:00", end: "13:00" }
    ])).toEqual([
      { start: "12:00", end: "13:00" },
      { start: "22:00", end: "07:00" }
    ]);
    expect(() => validateQuietHours(undefined)).toThrow("inválidas");
    expect(() => validateQuietHours(Array.from(
      { length: 13 },
      (_, index) => ({ start: `${String(index).padStart(2, "0")}:00`, end: "23:00" })
    ))).toThrow("no máximo 12");
  });

  it("returns the end of a same-day window", () => {
    const now = new Date(2026, 6, 24, 12, 30);
    expect(quietUntil([{ start: "12:00", end: "13:30" }], now))
      .toEqual(new Date(2026, 6, 24, 13, 30));
  });

  it("supports overnight windows on both sides of midnight", () => {
    const windows = [{ start: "22:00", end: "07:00" }];
    expect(quietUntil(windows, new Date(2026, 6, 24, 23, 0)))
      .toEqual(new Date(2026, 6, 25, 7, 0));
    expect(quietUntil(windows, new Date(2026, 6, 25, 6, 30)))
      .toEqual(new Date(2026, 6, 25, 7, 0));
    expect(quietUntil(windows, new Date(2026, 6, 25, 7, 0))).toBeUndefined();
  });

  it("uses the latest end when active windows overlap", () => {
    expect(quietUntil([
      { start: "11:00", end: "12:30" },
      { start: "12:00", end: "14:00" }
    ], new Date(2026, 6, 24, 12, 15))).toEqual(new Date(2026, 6, 24, 14, 0));
  });
});
