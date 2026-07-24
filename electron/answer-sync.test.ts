import { describe, expect, it, vi } from "vitest";
import { syncNextAnswer } from "./answer-sync";
import { ApiError } from "./pulse-api";
import { emptyDailyState, queueAnswer } from "./question-state";

const now = new Date(2026, 6, 24, 10, 0, 0);
const pendingQuestion = {
  employeeId: "employee-1",
  date: "2026-07-24",
  answered: false,
  answerStatus: "unanswered" as const,
  question: {
    id: "question-1",
    text: "Pergunta?",
    choices: [{ value: "5", label: "Concordo" }]
  }
};

function queuedState() {
  return queueAnswer(
    emptyDailyState(),
    { date: "2026-07-24", questionId: "question-1", value: "5" },
    now,
    "answer-1"
  );
}

describe("daily answer synchronization", () => {
  it("validates remotely before submitting a queued answer", async () => {
    const getQuestion = vi.fn().mockResolvedValue(pendingQuestion);
    const submitAnswer = vi.fn().mockResolvedValue(undefined);

    const result = await syncNextAnswer(queuedState(), now, { getQuestion, submitAnswer });

    expect(getQuestion).toHaveBeenCalledBefore(submitAnswer);
    expect(submitAnswer).toHaveBeenCalledWith(expect.objectContaining({
      questionId: "question-1",
      value: "5"
    }));
    expect(result.outcome).toBe("synced");
    expect(result.state.outbox).toHaveLength(0);
  });

  it("does not submit when Slack or email already answered", async () => {
    const submitAnswer = vi.fn();
    const result = await syncNextAnswer(queuedState(), now, {
      getQuestion: vi.fn().mockResolvedValue({
        ...pendingQuestion,
        answered: true,
        answerStatus: "external"
      }),
      submitAnswer
    });

    expect(submitAnswer).not.toHaveBeenCalled();
    expect(result.outcome).toBe("external");
    expect(result.state.lastAnswerStatus).toBe("external");
    expect(result.state.outbox).toHaveLength(0);
  });

  it("treats an atomic server conflict as an externally completed answer", async () => {
    const result = await syncNextAnswer(queuedState(), now, {
      getQuestion: vi.fn().mockResolvedValue(pendingQuestion),
      submitAnswer: vi.fn().mockRejectedValue(new ApiError("already answered", 409))
    });

    expect(result.outcome).toBe("external");
    expect(result.state.outbox).toHaveLength(0);
  });

  it("keeps the answer queued when preflight or submit is unavailable", async () => {
    const result = await syncNextAnswer(queuedState(), now, {
      getQuestion: vi.fn().mockRejectedValue(new ApiError("unavailable", 503)),
      submitAnswer: vi.fn()
    }, () => 0.5);

    expect(result.outcome).toBe("deferred");
    expect(result.status).toBe(503);
    expect(result.state.outbox[0]).toMatchObject({ id: "answer-1", attempts: 1 });
  });

  it("does not submit a stale answer for a changed question", async () => {
    const submitAnswer = vi.fn();
    const result = await syncNextAnswer(queuedState(), now, {
      getQuestion: vi.fn().mockResolvedValue({
        ...pendingQuestion,
        question: { ...pendingQuestion.question, id: "question-2" }
      }),
      submitAnswer
    }, () => 0.5);

    expect(submitAnswer).not.toHaveBeenCalled();
    expect(result.outcome).toBe("deferred");
  });

  it("does nothing until the persisted retry becomes due", async () => {
    const state = queuedState();
    state.outbox[0].nextAttemptAt = new Date(now.getTime() + 60_000).toISOString();
    const getQuestion = vi.fn();

    const result = await syncNextAnswer(state, now, {
      getQuestion,
      submitAnswer: vi.fn()
    });

    expect(result.outcome).toBe("idle");
    expect(getQuestion).not.toHaveBeenCalled();
  });
});
