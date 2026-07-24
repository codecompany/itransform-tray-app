import type { FeedbackContent, FeedbackDraft, FeedbackMethod } from "../src/contracts.js";

const fieldMax = 600;
const totalMax = 2_400;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > fieldMax) {
    throw new Error(`${label} inválido.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > fieldMax) {
    throw new Error(`${label} inválido.`);
  }
  return value.trim();
}

export function validateFeedbackDraft(raw: unknown): FeedbackDraft {
  const input = raw as Partial<FeedbackDraft>;
  const method = input.method as FeedbackMethod;
  if (method !== "situational" && method !== "development") {
    throw new Error("Escolha um método de feedback.");
  }
  const rawContent = (input.content ?? {}) as Partial<FeedbackContent>;
  const content: FeedbackContent = {
    context: requiredString(rawContent.context, "Contexto ou evidências"),
    observedBehavior: optionalString(rawContent.observedBehavior, "Comportamento observado"),
    perceivedImpact: optionalString(rawContent.perceivedImpact, "Impacto percebido"),
    suggestedNextStep: optionalString(rawContent.suggestedNextStep, "Próximo passo sugerido"),
    continueDoing: optionalString(rawContent.continueDoing, "Continuar fazendo"),
    startDoing: optionalString(rawContent.startDoing, "Começar a fazer"),
    stopDoing: optionalString(rawContent.stopDoing, "Parar de fazer")
  };
  if (method === "situational") {
    content.observedBehavior = requiredString(
      rawContent.observedBehavior,
      "Comportamento observado"
    );
    content.perceivedImpact = requiredString(rawContent.perceivedImpact, "Impacto percebido");
    content.suggestedNextStep = requiredString(
      rawContent.suggestedNextStep,
      "Próximo passo sugerido"
    );
    content.continueDoing = "";
    content.startDoing = "";
    content.stopDoing = "";
  } else {
    content.observedBehavior = "";
    content.perceivedImpact = "";
    content.suggestedNextStep = "";
    if (!content.continueDoing && !content.startDoing && !content.stopDoing) {
      throw new Error("Preencha ao menos uma ação: continuar, começar ou parar.");
    }
  }
  const total = Object.values(content).reduce((sum, value) => sum + value.length, 0);
  if (total > totalMax) {
    throw new Error(`O feedback deve ter no máximo ${totalMax} caracteres.`);
  }
  const importance = Number(input.importance);
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new Error("A importância deve estar entre 1 e 5.");
  }
  const toEmployeeId = typeof input.toEmployeeId === "string"
    ? input.toEmployeeId.trim()
    : "";
  if (!toEmployeeId || toEmployeeId.length > 200) {
    throw new Error("Colaborador inválido.");
  }
  return { toEmployeeId, method, importance, content };
}
