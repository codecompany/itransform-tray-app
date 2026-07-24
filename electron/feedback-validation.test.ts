import { describe, expect, it } from "vitest";
import { validateFeedbackDraft } from "./feedback-validation";

describe("structured feedback validation", () => {
  it("accepts all situational fields and removes development content", () => {
    expect(validateFeedbackDraft({
      toEmployeeId: "employee-2",
      method: "situational",
      importance: 4,
      content: {
        context: "Na revisão de segunda",
        observedBehavior: "Você antecipou os riscos",
        perceivedImpact: "Evitamos retrabalho",
        suggestedNextStep: "Compartilhe o checklist",
        continueDoing: "não deve sobreviver"
      }
    })).toEqual(expect.objectContaining({
      method: "situational",
      content: expect.objectContaining({
        continueDoing: "",
        observedBehavior: "Você antecipou os riscos"
      })
    }));
  });

  it("requires context and at least one development action", () => {
    expect(() => validateFeedbackDraft({
      toEmployeeId: "employee-2",
      method: "development",
      importance: 3,
      content: { context: "Nas últimas entregas" }
    })).toThrow("Preencha ao menos uma ação");
  });

  it("accepts partial continue, start and stop feedback", () => {
    expect(validateFeedbackDraft({
      toEmployeeId: "employee-2",
      method: "development",
      importance: 3,
      content: {
        context: "Nas últimas entregas",
        startDoing: "Compartilhe riscos mais cedo"
      }
    }).content.startDoing).toBe("Compartilhe riscos mais cedo");
  });
});
