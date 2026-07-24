import { describe, expect, it, vi } from "vitest";
import { createTrayMenuTemplate, type TrayMenuActions } from "./tray-menu";

function actions(): TrayMenuActions {
  return {
    openDailyQuestion: vi.fn(),
    openFeedbacks: vi.fn(),
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

  it("groups feedback actions and keeps adjustments explicit", () => {
    const callbacks = actions();
    const template = createTrayMenuTemplate(callbacks);

    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Feedbacks",
        click: callbacks.openFeedbacks
      }),
      expect.objectContaining({
        label: "Ajustes",
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
