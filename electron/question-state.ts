import type { AnswerStatus, DailyQuestion } from "../src/contracts.js";

export type CachedDailyQuestion = Omit<DailyQuestion, "answered" | "answerStatus">;

export interface PendingAnswer {
  id: string;
  date: string;
  questionId: string;
  value: string;
  queuedAt: string;
  attempts: number;
  nextAttemptAt: string;
}

export interface DailyState {
  cachedQuestion?: CachedDailyQuestion;
  nextCheckAt?: string;
  nextPromptAt?: string;
  skipCount: number;
  checkFailures: number;
  lastAnswerDate?: string;
  lastAnswerQuestionId?: string;
  lastAnswerStatus?: Exclude<AnswerStatus, "unanswered">;
  outbox: PendingAnswer[];
}

const minuteMs = 60_000;
const morningHour = 9;
const questionFailureMinutes = [5, 15, 30, 60];
const answerFailureMinutes = [1, 5, 15, 60, 180];
const skipMinutes = [60, 120, 180, 240];

export function emptyDailyState(): DailyState {
  return { skipCount: 0, checkFailures: 0, outbox: [] };
}

export function normalizeDailyState(value: unknown): DailyState {
  if (!value || typeof value !== "object") return emptyDailyState();
  const raw = value as Partial<DailyState>;
  return {
    cachedQuestion: raw.cachedQuestion,
    nextCheckAt: validTimestamp(raw.nextCheckAt),
    nextPromptAt: validTimestamp(raw.nextPromptAt),
    skipCount: nonNegativeInteger(raw.skipCount),
    checkFailures: nonNegativeInteger(raw.checkFailures),
    lastAnswerDate: raw.lastAnswerDate,
    lastAnswerQuestionId: raw.lastAnswerQuestionId,
    lastAnswerStatus: raw.lastAnswerStatus,
    outbox: Array.isArray(raw.outbox)
      ? raw.outbox.filter(validPendingAnswer).slice(-14)
      : []
  };
}

export function isDue(timestamp: string | undefined, now: Date): boolean {
  if (!timestamp) return true;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value <= now.getTime();
}

export function nextMorningAt(now: Date): string {
  const next = new Date(now);
  next.setHours(morningHour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function shouldPromptAutomatically(launchedHidden: boolean, now: Date): boolean {
  return !launchedHidden || now.getHours() >= morningHour;
}

export function nextQuestionRetryAt(
  now: Date,
  kind: "not-found" | "failure" | "poll",
  failureCount: number,
  random = Math.random
): string {
  if (kind === "not-found" && now.getHours() < morningHour) {
    const morning = new Date(now);
    morning.setHours(morningHour, 0, 0, 0);
    return morning.toISOString();
  }
  if (kind === "poll") return addJitteredMinutes(now, 5, random);
  const index = Math.min(nonNegativeInteger(failureCount), questionFailureMinutes.length - 1);
  const base = kind === "not-found" ? 30 : questionFailureMinutes[index];
  return addJitteredMinutes(now, base, random);
}

export function snoozeQuestion(
  state: DailyState,
  now: Date,
  random = Math.random
): DailyState {
  const skipCount = state.skipCount + 1;
  const base = skipMinutes[Math.min(skipCount - 1, skipMinutes.length - 1)];
  const nextPromptAt = addJitteredMinutes(now, base, random);
  return {
    ...state,
    skipCount,
    nextPromptAt,
    nextCheckAt: nextPromptAt
  };
}

export function cacheQuestion(
  state: DailyState,
  question: CachedDailyQuestion
): DailyState {
  const changedDate = state.cachedQuestion?.date !== question.date;
  return {
    ...state,
    cachedQuestion: question,
    skipCount: changedDate ? 0 : state.skipCount,
    nextPromptAt: changedDate ? undefined : state.nextPromptAt,
    checkFailures: 0
  };
}

export function queueAnswer(
  state: DailyState,
  input: Pick<PendingAnswer, "date" | "questionId" | "value">,
  now: Date,
  id: string = crypto.randomUUID()
): DailyState {
  const pending: PendingAnswer = {
    ...input,
    id,
    queuedAt: now.toISOString(),
    attempts: 0,
    nextAttemptAt: now.toISOString()
  };
  return {
    ...state,
    lastAnswerDate: input.date,
    lastAnswerQuestionId: input.questionId,
    lastAnswerStatus: "pending-sync",
    nextPromptAt: undefined,
    nextCheckAt: nextMorningAt(now),
    outbox: [...state.outbox.filter((item) => item.date !== input.date), pending].slice(-14)
  };
}

export function dueAnswer(state: DailyState, now: Date): PendingAnswer | undefined {
  return [...state.outbox]
    .sort((left, right) => Date.parse(left.nextAttemptAt) - Date.parse(right.nextAttemptAt))
    .find((item) => isDue(item.nextAttemptAt, now));
}

export function deferAnswer(
  state: DailyState,
  answerId: string,
  now: Date,
  random = Math.random
): DailyState {
  return {
    ...state,
    outbox: state.outbox.map((item) => {
      if (item.id !== answerId) return item;
      const attempts = item.attempts + 1;
      const index = Math.min(attempts - 1, answerFailureMinutes.length - 1);
      return {
        ...item,
        attempts,
        nextAttemptAt: addJitteredMinutes(now, answerFailureMinutes[index], random)
      };
    })
  };
}

export function resolveAnswer(
  state: DailyState,
  date: string,
  questionId: string,
  status: "synced" | "external"
): DailyState {
  return {
    ...state,
    lastAnswerDate: date,
    lastAnswerQuestionId: questionId,
    lastAnswerStatus: status,
    nextPromptAt: undefined,
    outbox: state.outbox.filter((item) => item.date !== date)
  };
}

export function answerStatusFor(state: DailyState, date: string): AnswerStatus {
  if (state.lastAnswerDate !== date) return "unanswered";
  return state.lastAnswerStatus ?? "synced";
}

function addJitteredMinutes(now: Date, baseMinutes: number, random: () => number): string {
  const factor = 0.75 + Math.min(1, Math.max(0, random())) * 0.5;
  return new Date(now.getTime() + Math.round(baseMinutes * factor * minuteMs)).toISOString();
}

function validTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function validPendingAnswer(value: unknown): value is PendingAnswer {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingAnswer>;
  return Boolean(
    item.id &&
    item.date &&
    item.questionId &&
    item.value &&
    validTimestamp(item.queuedAt) &&
    validTimestamp(item.nextAttemptAt) &&
    typeof item.attempts === "number"
  );
}
