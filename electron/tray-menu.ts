import type { MenuItemConstructorOptions } from "electron";
import { PRODUCT_NAME } from "../src/product.js";

export interface TrayMenuActions {
  openDailyQuestion(): void;
  openSendFeedback(): void;
  openReceivedFeedback(): void;
  openSettings(): void;
  quit(): void;
}

export function createTrayMenuTemplate(
  actions: TrayMenuActions
): MenuItemConstructorOptions[] {
  return [
    { label: "Questão diária", click: actions.openDailyQuestion },
    { type: "separator" },
    { label: "Enviar feedback", click: actions.openSendFeedback },
    { label: "Feedbacks recebidos", click: actions.openReceivedFeedback },
    { label: "Ajustes", click: actions.openSettings },
    { type: "separator" },
    { label: `Encerrar ${PRODUCT_NAME}`, click: actions.quit }
  ];
}
