import { describe, expect, it } from "vitest";
import {
  answerStatusFor,
  cacheQuestion,
  deferAnswer,
  dueAnswer,
  emptyDailyState,
  isDue,
  nextMorningAt,
  nextQuestionRetryAt,
  normalizeDailyState,
  queueAnswer,
  resolveAnswer,
  shouldPromptAutomatically,
  snoozeQuestion
} from "./question-state";

const now = new Date(2026, 6, 24, 9, 0, 0);
const question = {
  employeeId: "employee-1",
  date: "2026-07-24",
  question: {
    id: "question-1",
    text: "Pergunta diária?",
    choices: [{ value: "5", label: "Concordo" }]
  }
};

describe("daily question local policy", () => {
  it("prompts on first login and waits until morning after hidden startup", () => {
    expect(shouldPromptAutomatically(false, new Date(2026, 6, 24, 6, 0, 0))).toBe(true);
    expect(shouldPromptAutomatically(true, new Date(2026, 6, 24, 8, 59, 0))).toBe(false);
    expect(shouldPromptAutomatically(true, new Date(2026, 6, 24, 9, 0, 0))).toBe(true);
  });

  it("uses the same morning when startup happens before 09:00", () => {
    const early = new Date(2026, 6, 24, 7, 30, 0);
    expect(nextQuestionRetryAt(early, "not-found", 0, () => 0.5))
      .toBe(new Date(2026, 6, 24, 9, 0, 0).toISOString());
  });

  it("uses the next morning after the morning window has passed", () => {
    expect(nextMorningAt(now)).toBe(new Date(2026, 6, 25, 9, 0, 0).toISOString());
  });

  it("snoozes with increasing bounded delays and persists the due time", () => {
    const first = snoozeQuestion(cacheQuestion(emptyDailyState(), question), now, () => 0.5);
    const second = snoozeQuestion(first, new Date(first.nextPromptAt!), () => 0.5);

    expect(first.skipCount).toBe(1);
    expect(Date.parse(first.nextPromptAt!) - now.getTime()).toBe(60 * 60_000);
    expect(Date.parse(second.nextPromptAt!) - Date.parse(first.nextPromptAt!)).toBe(120 * 60_000);
    expect(second.nextCheckAt).toBe(second.nextPromptAt);
  });

  it("queues before network sync and deduplicates by calendar date", () => {
    const first = queueAnswer(
      emptyDailyState(),
      { date: question.date, questionId: question.question.id, value: "5" },
      now,
      "answer-1"
    );
    const replaced = queueAnswer(
      first,
      { date: question.date, questionId: question.question.id, value: "4" },
      now,
      "answer-2"
    );

    expect(replaced.outbox).toHaveLength(1);
    expect(replaced.outbox[0]).toMatchObject({ id: "answer-2", value: "4", attempts: 0 });
    expect(answerStatusFor(replaced, question.date)).toBe("pending-sync");
    expect(dueAnswer(replaced, now)?.id).toBe("answer-2");
  });

  it("backs off a failed sync with jitter and later resolves it", () => {
    const queued = queueAnswer(
      emptyDailyState(),
      { date: question.date, questionId: question.question.id, value: "5" },
      now,
      "answer-1"
    );
    const deferred = deferAnswer(queued, "answer-1", now, () => 0.5);

    expect(deferred.outbox[0].attempts).toBe(1);
    expect(Date.parse(deferred.outbox[0].nextAttemptAt) - now.getTime()).toBe(60_000);
    expect(isDue(deferred.outbox[0].nextAttemptAt, now)).toBe(false);

    const resolved = resolveAnswer(deferred, question.date, question.question.id, "synced");
    expect(resolved.outbox).toHaveLength(0);
    expect(answerStatusFor(resolved, question.date)).toBe("synced");
  });

  it("marks an answer observed from another channel", () => {
    const resolved = resolveAnswer(
      cacheQuestion(emptyDailyState(), question),
      question.date,
      question.question.id,
      "external"
    );
    expect(answerStatusFor(resolved, question.date)).toBe("external");
  });

  it("normalizes corrupt persisted values without losing valid queued answers", () => {
    const queued = queueAnswer(
      emptyDailyState(),
      { date: question.date, questionId: question.question.id, value: "5" },
      now,
      "answer-1"
    );
    const normalized = normalizeDailyState({
      ...queued,
      skipCount: -2,
      checkFailures: Number.NaN,
      outbox: [{ bad: true }, ...queued.outbox]
    });

    expect(normalized.skipCount).toBe(0);
    expect(normalized.checkFailures).toBe(0);
    expect(normalized.outbox).toEqual(queued.outbox);
  });

  it("caps repeated question failures and keeps full jitter bounded", () => {
    const lower = nextQuestionRetryAt(now, "failure", 99, () => 0);
    const upper = nextQuestionRetryAt(now, "failure", 99, () => 1);
    expect(Date.parse(lower) - now.getTime()).toBe(45 * 60_000);
    expect(Date.parse(upper) - now.getTime()).toBe(75 * 60_000);
  });
});
