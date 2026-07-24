import type { DailyQuestion } from "../src/contracts.js";
import { ApiError } from "./pulse-api.js";
import {
  deferAnswer,
  dueAnswer,
  resolveAnswer,
  type DailyState,
  type PendingAnswer
} from "./question-state.js";

export interface AnswerSyncGateway {
  getQuestion(): Promise<DailyQuestion | null>;
  submitAnswer(answer: PendingAnswer): Promise<void>;
}

export interface AnswerSyncResult {
  state: DailyState;
  outcome: "idle" | "deferred" | "synced" | "external";
  answer?: PendingAnswer;
  status?: number;
}

export async function syncNextAnswer(
  state: DailyState,
  now: Date,
  gateway: AnswerSyncGateway,
  random = Math.random
): Promise<AnswerSyncResult> {
  const answer = dueAnswer(state, now);
  if (!answer) return { state, outcome: "idle" };
  try {
    const remote = await gateway.getQuestion();
    if (remote?.answered) {
      return {
        state: resolveAnswer(state, answer.date, answer.questionId, "external"),
        outcome: "external",
        answer
      };
    }
    if (!remote || remote.date !== answer.date || remote.question.id !== answer.questionId) {
      return {
        state: deferAnswer(state, answer.id, now, random),
        outcome: "deferred",
        answer
      };
    }
    await gateway.submitAnswer(answer);
    return {
      state: resolveAnswer(state, answer.date, answer.questionId, "synced"),
      outcome: "synced",
      answer
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return {
        state: resolveAnswer(state, answer.date, answer.questionId, "external"),
        outcome: "external",
        answer,
        status: error.status
      };
    }
    return {
      state: deferAnswer(state, answer.id, now, random),
      outcome: "deferred",
      answer,
      status: error instanceof ApiError ? error.status : undefined
    };
  }
}
