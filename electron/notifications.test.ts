import { describe, expect, it } from "vitest";
import { notificationFor } from "./notifications";

describe("native notification policy", () => {
  it("routes the daily reminder to the mandatory question without private content", () => {
    expect(notificationFor("daily-question")).toEqual({
      body: "Sua pergunta diária está pronta.",
      required: true,
      view: "question"
    });
  });

  it("uses a generic native confirmation for feedback", () => {
    const notice = notificationFor("feedback-sent");
    expect(notice).toEqual({
      body: "Seu feedback foi enviado com sucesso.",
      required: false,
      view: "feedback"
    });
    expect(notice.body).not.toContain("@");
  });

  it("uses generic native notices for linking and schedule changes", () => {
    expect(notificationFor("linked")).toEqual({
      body: "Este dispositivo foi vinculado ao Sintonia.",
      required: false,
      view: "feedback"
    });
    expect(notificationFor("schedule-updated", "08:30")).toEqual({
      body: "A pergunta diária será exibida às 08:30.",
      required: false,
      view: "settings"
    });
    expect(notificationFor("schedule-updated").body)
      .toBe("Horário da pergunta diária atualizado.");
  });
});
