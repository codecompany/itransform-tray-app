import type { QuietHoursWindow } from "../src/contracts.js";

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const maximumWindows = 12;

function minuteOfDay(value: string): number | undefined {
  const match = timePattern.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeQuietHours(value: unknown): QuietHoursWindow[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Map<string, QuietHoursWindow>();
  for (const item of value.slice(0, maximumWindows)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<QuietHoursWindow>;
    const start = typeof raw.start === "string" ? raw.start.trim() : "";
    const end = typeof raw.end === "string" ? raw.end.trim() : "";
    if (minuteOfDay(start) === undefined || minuteOfDay(end) === undefined || start === end) {
      continue;
    }
    normalized.set(`${start}-${end}`, { start, end });
  }
  return [...normalized.values()].sort((left, right) =>
    left.start.localeCompare(right.start) || left.end.localeCompare(right.end)
  );
}

export function validateQuietHours(value: unknown): QuietHoursWindow[] {
  if (!Array.isArray(value)) throw new Error("As janelas de silêncio são inválidas.");
  if (value.length > maximumWindows) {
    throw new Error(`Configure no máximo ${maximumWindows} janelas de silêncio.`);
  }
  const normalized = normalizeQuietHours(value);
  if (normalized.length !== value.length) {
    throw new Error("Informe horários válidos e diferentes para início e fim.");
  }
  return normalized;
}

export function quietUntil(
  windows: QuietHoursWindow[],
  now: Date
): Date | undefined {
  const minute = now.getHours() * 60 + now.getMinutes();
  const candidates: Date[] = [];
  for (const window of normalizeQuietHours(windows)) {
    const start = minuteOfDay(window.start)!;
    const end = minuteOfDay(window.end)!;
    if (start < end && minute >= start && minute < end) {
      const until = new Date(now);
      until.setHours(Math.floor(end / 60), end % 60, 0, 0);
      candidates.push(until);
    }
    if (start > end && (minute >= start || minute < end)) {
      const until = new Date(now);
      until.setHours(Math.floor(end / 60), end % 60, 0, 0);
      if (minute >= start) until.setDate(until.getDate() + 1);
      candidates.push(until);
    }
  }
  if (!candidates.length) return undefined;
  return new Date(Math.max(...candidates.map((candidate) => candidate.getTime())));
}
