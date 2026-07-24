import type { MenuItemConstructorOptions } from "electron";
import { PRODUCT_NAME } from "../src/product.js";

export interface TrayMenuActions {
  openDailyQuestion(): void;
  openFeedbackComposer(): void;
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
    { label: "Enviar Feedback", click: actions.openFeedbackComposer },
    { label: "Receber Feedback", click: actions.openReceivedFeedback },
    { type: "separator" },
    { label: "Configurações", click: actions.openSettings },
    { type: "separator" },
    { label: `Encerrar ${PRODUCT_NAME}`, click: actions.quit }
  ];
}
