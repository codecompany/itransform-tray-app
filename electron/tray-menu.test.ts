import { describe, expect, it, vi } from "vitest";
import { createTrayMenuTemplate, type TrayMenuActions } from "./tray-menu";

function actions(): TrayMenuActions {
  return {
    openDailyQuestion: vi.fn(),
    openSendFeedback: vi.fn(),
    openRequestFeedback: vi.fn(),
    openSettings: vi.fn(),
    quit: vi.fn()
  };
}

describe("tray menu", () => {
  it("uses the requested order and labels after linking", () => {
    const callbacks = actions();
    const template = createTrayMenuTemplate(callbacks, true);

    expect(template).toEqual([
      {
        label: "Pergunta do dia",
        enabled: true,
        click: callbacks.openDailyQuestion
      },
      { type: "separator" },
      {
        label: "Enviar feedback",
        enabled: true,
        click: callbacks.openSendFeedback
      },
      {
        label: "Solicitar Feedback",
        enabled: true,
        click: callbacks.openRequestFeedback
      },
      { type: "separator" },
      {
        label: "Ajustes",
        enabled: true,
        click: callbacks.openSettings
      },
      {
        label: "Encerrar iTransform",
        click: callbacks.quit
      }
    ]);
  });

  it("disables session actions before linking and keeps quit available", () => {
    const template = createTrayMenuTemplate(actions(), false);

    expect(template.filter((item) => item.type !== "separator").map((item) => ({
      label: item.label,
      enabled: item.enabled
    }))).toEqual([
      { label: "Pergunta do dia", enabled: false },
      { label: "Enviar feedback", enabled: false },
      { label: "Solicitar Feedback", enabled: false },
      { label: "Ajustes", enabled: false },
      { label: "Encerrar iTransform", enabled: undefined }
    ]);
  });
});
