import type { DailyQuestion } from "../src/contracts.js";
import { syncNextAnswer, type AnswerSyncGateway } from "./answer-sync.js";
import {
  answerStatusFor,
  cacheQuestion,
  isDue,
  nextMorningAt,
  nextQuestionRetryAt,
  queueAnswer,
  resolveAnswer,
  snoozeQuestion,
  type CachedDailyQuestion,
  type DailyState
} from "./question-state.js";
import { localDate } from "./scheduler.js";
import type { SessionStore } from "./session-store.js";
import { ApiError } from "./pulse-api.js";

interface DailyQuestionGateway extends AnswerSyncGateway {
  getQuestion(): Promise<DailyQuestion | null>;
}

interface DailyQuestionCallbacks {
  prompt(): void;
  release(): void;
}

interface AnswerInput {
  questionId: string;
  value: string;
  date: string;
}

export class DailyQuestionCoordinator {
  private question: DailyQuestion | null;
  private taskInFlight = false;

  constructor(
    private readonly store: SessionStore,
    private readonly gateway: DailyQuestionGateway,
    private readonly callbacks: DailyQuestionCallbacks
  ) {
    this.question = this.cachedQuestionView();
  }

  current(): DailyQuestion | null {
    return this.question;
  }

  clear(): void {
    this.question = null;
  }

  async run(
    now: Date,
    promptWhenAvailable: boolean,
    nextAllowedPromptAt?: Date
  ): Promise<void> {
    if (this.taskInFlight || !this.store.snapshot().profile) return;
    this.taskInFlight = true;
    try {
      await this.syncPendingAnswer(now);
      if (this.store.snapshot().profile && isDue(this.store.daily().nextCheckAt, now)) {
        await this.check(now, promptWhenAvailable, nextAllowedPromptAt);
      }
    } finally {
      this.taskInFlight = false;
    }
  }

  async check(
    now = new Date(),
    promptWhenAvailable = true,
    nextAllowedPromptAt?: Date
  ): Promise<void> {
    if (!this.store.snapshot().profile) return;
    try {
      const remote = await this.gateway.getQuestion();
      if (remote) {
        await this.applyRemoteQuestion(
          remote,
          now,
          promptWhenAvailable,
          nextAllowedPromptAt
        );
        return;
      }
      await this.deferQuestionCheck(
        now,
        "not-found",
        promptWhenAvailable,
        nextAllowedPromptAt
      );
    } catch (error) {
      if (!this.store.snapshot().profile) return;
      await this.deferQuestionCheck(
        now,
        "failure",
        promptWhenAvailable,
        nextAllowedPromptAt
      );
      console.warn(JSON.stringify({
        event: "daily_question_check_failed",
        status: error instanceof ApiError ? error.status : undefined
      }));
    }
  }

  async answer(input: AnswerInput, now = new Date()): Promise<void> {
    if (
      !this.question ||
      this.question.question.id !== input.questionId ||
      this.question.date !== input.date
    ) {
      throw new Error("A pergunta mudou. Recarregue antes de responder.");
    }
    if (!this.question.question.choices.some((choice) => choice.value === input.value)) {
      throw new Error("Selecione uma alternativa válida.");
    }
    if (answerStatusFor(this.store.daily(), input.date) !== "unanswered") {
      throw new Error("A pergunta de hoje já foi respondida.");
    }
    const next = queueAnswer({ ...this.store.daily() }, input, now);
    await this.store.setDaily(next, {
      kind: "system",
      title: "Resposta diária salva",
      detail: "O iTransform Pulse sincronizará a resposta automaticamente."
    });
    this.question = {
      ...this.question,
      answered: true,
      answerStatus: "pending-sync"
    };
    this.callbacks.release();
  }

  async skip(now = new Date()): Promise<void> {
    if (!this.question || this.question.answered) {
      throw new Error("Não há uma pergunta pendente para pular.");
    }
    const next = snoozeQuestion({ ...this.store.daily() }, now);
    await this.store.setDaily(next, {
      kind: "system",
      title: "Pergunta diária adiada",
      detail: "O iTransform Pulse perguntará novamente mais tarde."
    });
    this.callbacks.release();
  }

  private questionView(
    question: CachedDailyQuestion,
    daily = this.store.daily()
  ): DailyQuestion {
    const answerStatus = answerStatusFor(daily, question.date);
    return {
      ...question,
      answered: answerStatus !== "unanswered",
      answerStatus
    };
  }

  private cachedQuestionView(): DailyQuestion | null {
    const cached = this.store.daily().cachedQuestion;
    return cached ? this.questionView(cached) : null;
  }

  private cachedFrom(question: DailyQuestion): CachedDailyQuestion {
    const { answered: _answered, answerStatus: _answerStatus, ...cached } = question;
    return cached;
  }

  private async syncPendingAnswer(now: Date): Promise<void> {
    const result = await syncNextAnswer(
      { ...this.store.daily() },
      now,
      this.gateway
    );
    if (result.outcome === "idle" || !this.store.snapshot().profile) return;
    if (result.outcome === "deferred") {
      await this.store.setDaily(result.state);
      console.warn(JSON.stringify({
        event: "daily_answer_sync_deferred",
        status: result.status,
        attempts: result.answer ? result.answer.attempts + 1 : undefined
      }));
      return;
    }
    result.state.nextCheckAt = nextMorningAt(now);
    await this.store.setDaily(result.state, {
      kind: "system",
      title: result.outcome === "synced"
        ? "Resposta diária sincronizada"
        : "Resposta diária já registrada",
      detail: result.outcome === "synced"
        ? "O servidor confirmou a resposta salva neste dispositivo."
        : "Outro canal já havia registrado a resposta de hoje."
    });
    this.question = this.cachedQuestionView();
    this.callbacks.release();
  }

  private async applyRemoteQuestion(
    remote: DailyQuestion,
    now: Date,
    promptWhenAvailable: boolean,
    nextAllowedPromptAt?: Date
  ): Promise<void> {
    const previous = this.store.daily();
    const cached = this.cachedFrom(remote);
    const wasCached = previous.cachedQuestion?.question.id === remote.question.id &&
      previous.cachedQuestion.date === remote.date;
    let next = cacheQuestion({ ...previous }, cached);
    if (remote.answered) {
      const status = previous.outbox.some((item) => item.date === remote.date)
        ? "synced"
        : "external";
      next = resolveAnswer(next, remote.date, remote.question.id, status);
      next.nextCheckAt = nextMorningAt(now);
      await this.store.setDaily(next, previous.lastAnswerDate === remote.date ? undefined : {
        kind: "system",
        title: "Pergunta diária já respondida",
        detail: "O servidor confirmou uma resposta enviada por um canal autorizado."
      });
      this.question = this.questionView(cached, next);
      this.callbacks.release();
      return;
    }

    const localStatus = answerStatusFor(next, remote.date);
    if (localStatus !== "unanswered") {
      next.nextCheckAt = nextMorningAt(now);
      await this.store.setDaily(next);
      this.question = this.questionView(cached, next);
      this.callbacks.release();
      return;
    }

    const shouldPrompt = promptWhenAvailable && isDue(next.nextPromptAt, now);
    if (shouldPrompt) {
      next.nextPromptAt = undefined;
      next.nextCheckAt = nextQuestionRetryAt(now, "poll", 0);
    } else {
      const promptAt = nextAllowedPromptAt?.toISOString() ??
        next.nextPromptAt ??
        nextMorningAt(now);
      next.nextPromptAt = promptAt;
      next.nextCheckAt = promptAt;
    }
    await this.store.setDaily(next, wasCached ? undefined : {
      kind: "system",
      title: "Pergunta diária disponível",
      detail: "A pergunta de hoje aguarda sua resposta."
    });
    this.question = this.questionView(cached, next);
    if (shouldPrompt) this.callbacks.prompt();
  }

  private async deferQuestionCheck(
    now: Date,
    kind: "not-found" | "failure",
    promptWhenAvailable: boolean,
    nextAllowedPromptAt?: Date
  ): Promise<void> {
    const next: DailyState = { ...this.store.daily() };
    next.checkFailures = kind === "failure" ? next.checkFailures + 1 : 0;
    next.nextCheckAt = nextQuestionRetryAt(now, kind, next.checkFailures);
    const cached = next.cachedQuestion;
    const shouldPromptCached = Boolean(
      cached &&
      cached.date === localDate(now) &&
      answerStatusFor(next, cached.date) === "unanswered" &&
      promptWhenAvailable &&
      isDue(next.nextPromptAt, now)
    );
    if (shouldPromptCached && cached) {
      next.nextPromptAt = undefined;
      this.question = this.questionView(cached, next);
    } else if (cached && nextAllowedPromptAt) {
      next.nextPromptAt = nextAllowedPromptAt.toISOString();
      next.nextCheckAt = next.nextPromptAt;
    }
    await this.store.setDaily(next);
    if (shouldPromptCached) this.callbacks.prompt();
  }
}
