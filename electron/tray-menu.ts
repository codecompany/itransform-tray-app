import type { MenuItemConstructorOptions } from "electron";

export interface TrayMenuActions {
  openDailyQuestion(): void;
  openSendFeedback(): void;
  openRequestFeedback(): void;
  openSettings(): void;
  quit(): void;
}

export function createTrayMenuTemplate(
  actions: TrayMenuActions,
  linked: boolean
): MenuItemConstructorOptions[] {
  return [
    { label: "Pergunta do dia", enabled: linked, click: actions.openDailyQuestion },
    { type: "separator" },
    { label: "Enviar feedback", enabled: linked, click: actions.openSendFeedback },
    { label: "Solicitar Feedback", enabled: linked, click: actions.openRequestFeedback },
    { type: "separator" },
    { label: "Ajustes", enabled: linked, click: actions.openSettings },
    { label: "Encerrar iTransform", click: actions.quit }
  ];
}
