import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyQuestion } from "../src/contracts";
import { ApiError } from "./sintonia";
import { DailyQuestionCoordinator } from "./daily-question-coordinator";
import { SessionStore } from "./session-store";

const directories: string[] = [];
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString()
};
const profile = {
  id: "employee-1",
  companyId: "company-1",
  userId: "user-1",
  name: "Ana Silva",
  email: "ana@example.com",
  position: "Designer",
  startDate: "2025-01-02"
};
const tokens = {
  employeeToken: "employee-token",
  knowledgeToken: "knowledge-token",
  pulseToken: "pulse-token",
  employeeId: "employee-1",
  expiresAt: "2026-07-24T18:00:00Z"
};
const question: DailyQuestion = {
  employeeId: "employee-1",
  date: "2026-07-24",
  answered: false,
  answerStatus: "unanswered",
  question: {
    id: "question-1",
    text: "Como foi seu dia?",
    choices: [
      { value: "5", label: "Muito bom" },
      { value: "1", label: "Difícil" }
    ]
  }
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { force: true, recursive: true })
  ));
});

async function createStore(): Promise<SessionStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pulsetray-daily-"));
  directories.push(directory);
  const store = new SessionStore(path.join(directory, "session.json"), storage);
  await store.link("tray-token", tokens, profile);
  return store;
}

async function setup(remote: DailyQuestion | null = question) {
  const store = await createStore();
  const gateway = {
    getQuestion: vi.fn().mockResolvedValue(remote),
    submitAnswer: vi.fn().mockResolvedValue(undefined)
  };
  const callbacks = {
    prompt: vi.fn(),
    release: vi.fn()
  };
  const coordinator = new DailyQuestionCoordinator(store, gateway, callbacks);
  return { callbacks, coordinator, gateway, store };
}

describe("daily question coordinator", () => {
  it("caches and prompts an available question", async () => {
    const { callbacks, coordinator, store } = await setup();

    await coordinator.check(new Date(2026, 6, 24, 9, 0, 0), true);

    expect(callbacks.prompt).toHaveBeenCalledOnce();
    expect(coordinator.current()).toMatchObject({
      answered: false,
      answerStatus: "unanswered",
      date: "2026-07-24"
    });
    expect(store.daily().cachedQuestion?.question.id).toBe("question-1");
    expect(store.snapshot().events.at(0)?.title).toBe("Pergunta diária disponível");
  });

  it("saves locally, releases the window and synchronizes after a server preflight", async () => {
    const { callbacks, coordinator, gateway, store } = await setup();
    const now = new Date(2026, 6, 24, 10, 0, 0);
    await coordinator.check(now, true);

    await coordinator.answer({
      questionId: "question-1",
      value: "5",
      date: "2026-07-24"
    }, now);

    expect(coordinator.current()?.answerStatus).toBe("pending-sync");
    expect(store.daily().outbox).toHaveLength(1);
    expect(callbacks.release).toHaveBeenCalledOnce();

    await coordinator.run(now, false);

    expect(gateway.getQuestion).toHaveBeenCalledBefore(gateway.submitAnswer);
    expect(store.daily().outbox).toHaveLength(0);
    expect(store.daily().lastAnswerStatus).toBe("synced");
    expect(callbacks.release).toHaveBeenCalledTimes(2);
  });

  it("snoozes with a persisted later prompt and rejects invalid answer state", async () => {
    const { callbacks, coordinator, store } = await setup();
    const now = new Date(2026, 6, 24, 10, 0, 0);
    await coordinator.check(now, true);

    await expect(coordinator.answer({
      questionId: "question-1",
      value: "not-a-choice",
      date: "2026-07-24"
    }, now)).rejects.toThrow("alternativa válida");
    await coordinator.skip(now);

    expect(Date.parse(store.daily().nextPromptAt!)).toBeGreaterThan(now.getTime());
    expect(callbacks.release).toHaveBeenCalledOnce();
    await expect(coordinator.skip(now)).resolves.toBeUndefined();
  });

  it("resolves a response observed from Slack or email without prompting", async () => {
    const { callbacks, coordinator, store } = await setup({
      ...question,
      answered: true,
      answerStatus: "external"
    });

    await coordinator.check(new Date(2026, 6, 24, 10, 0, 0), true);

    expect(callbacks.prompt).not.toHaveBeenCalled();
    expect(callbacks.release).toHaveBeenCalledOnce();
    expect(coordinator.current()?.answerStatus).toBe("external");
    expect(store.daily().lastAnswerStatus).toBe("external");
  });

  it("waits until morning when no question exists before 09:00", async () => {
    const { callbacks, coordinator, store } = await setup(null);

    await coordinator.check(new Date(2026, 6, 24, 7, 0, 0), true);

    expect(callbacks.prompt).not.toHaveBeenCalled();
    expect(store.daily().nextCheckAt)
      .toBe(new Date(2026, 6, 24, 9, 0, 0).toISOString());
  });

  it("uses a cached question during an outage and preserves a queued answer", async () => {
    const { callbacks, coordinator, gateway, store } = await setup();
    const now = new Date(2026, 6, 24, 10, 0, 0);
    await coordinator.check(now, false);
    await store.setDaily({
      ...store.daily(),
      nextCheckAt: new Date(now.getTime() - 1).toISOString(),
      nextPromptAt: new Date(now.getTime() - 1).toISOString()
    });
    gateway.getQuestion.mockRejectedValue(new ApiError("unavailable", 503));

    await coordinator.check(now, true);

    expect(callbacks.prompt).toHaveBeenCalledOnce();
    expect(store.daily().checkFailures).toBe(1);
    expect(coordinator.current()?.question.id).toBe("question-1");
  });

  it("does not overwrite a locally pending answer with a stale remote state", async () => {
    const { callbacks, coordinator, store } = await setup();
    const now = new Date(2026, 6, 24, 10, 0, 0);
    await coordinator.check(now, false);
    await coordinator.answer({
      questionId: "question-1",
      value: "5",
      date: "2026-07-24"
    }, now);
    callbacks.release.mockClear();

    await coordinator.check(now, true);

    expect(callbacks.prompt).not.toHaveBeenCalled();
    expect(callbacks.release).toHaveBeenCalledOnce();
    expect(store.daily().outbox).toHaveLength(1);
    coordinator.clear();
    expect(coordinator.current()).toBeNull();
  });
});
