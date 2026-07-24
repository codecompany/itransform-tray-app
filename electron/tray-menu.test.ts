import { describe, expect, it, vi } from "vitest";
import { createTrayMenuTemplate, type TrayMenuActions } from "./tray-menu";

function actions(): TrayMenuActions {
  return {
    openDailyQuestion: vi.fn(),
    openFeedbackComposer: vi.fn(),
    openReceivedFeedback: vi.fn(),
    openSettings: vi.fn(),
    quit: vi.fn()
  };
}

describe("tray menu", () => {
  it("places a separator immediately after the daily question", () => {
    const template = createTrayMenuTemplate(actions());

    expect(template[0]).toMatchObject({ label: "Questão diária" });
    expect(template[1]).toEqual({ type: "separator" });
  });

  it("opens windows only from explicit menu actions", () => {
    const callbacks = actions();
    const template = createTrayMenuTemplate(callbacks);

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Enviar Feedback",
        click: callbacks.openFeedbackComposer
      }),
      expect.objectContaining({
        label: "Receber Feedback",
        click: callbacks.openReceivedFeedback
      }),
      expect.objectContaining({
        label: "Configurações",
        click: callbacks.openSettings
      })
    ]));
  });

  it("uses the public product name in the quit action", () => {
    const template = createTrayMenuTemplate(actions());

    expect(template.at(-1)).toMatchObject({
      label: "Encerrar iTransform Pulse"
    });
  });
});
