import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { queueAnswer } from "./question-state";
import { SessionStore } from "./session-store";

const tempDirectories: string[] = [];
const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, "")
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
  expiresAt: "2026-07-24T12:00:00Z"
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

async function sessionFile(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pulsetray-session-"));
  tempDirectories.push(directory);
  return path.join(directory, "session.json");
}

describe("encrypted session store", () => {
  it("persists queued answers without exposing their values in plaintext", async () => {
    const file = await sessionFile();
    const store = new SessionStore(file, secureStorage);
    await store.link("durable-token", tokens, profile);
    const daily = queueAnswer(
      { ...store.daily() },
      { date: "2026-07-24", questionId: "question-1", value: "sensitive-choice" },
      new Date("2026-07-24T12:00:00Z"),
      "answer-1"
    );
    await store.setDaily(daily);

    const persisted = await fs.readFile(file, "utf8");
    expect(persisted).not.toContain("sensitive-choice");
    expect(persisted).not.toContain("durable-token");

    const reopened = new SessionStore(file, secureStorage);
    await reopened.load();
    expect(reopened.daily().outbox).toEqual(daily.outbox);
    expect(reopened.token()).toBe("durable-token");
  });

  it("migrates the legacy local answer marker", async () => {
    const file = await sessionFile();
    await fs.writeFile(file, JSON.stringify({
      tokenCipher: secureStorage.encryptString("token").toString("base64"),
      tokensCipher: secureStorage.encryptString(JSON.stringify(tokens)).toString("base64"),
      profile,
      lastAnswerDate: "2026-07-23",
      lastAnswerQuestionId: "question-legacy",
      events: []
    }));
    const store = new SessionStore(file, secureStorage);

    await store.load();

    expect(store.daily()).toMatchObject({
      lastAnswerDate: "2026-07-23",
      lastAnswerQuestionId: "question-legacy",
      lastAnswerStatus: "synced"
    });
  });
});
