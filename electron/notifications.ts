import type { AppView } from "../src/contracts.js";

export type NativeNotificationKind =
  | "daily-question"
  | "feedback-sent"
  | "linked";

export interface NativeNotificationPolicy {
  body: string;
  required: boolean;
  view: AppView;
}

export function notificationFor(kind: NativeNotificationKind): NativeNotificationPolicy {
  switch (kind) {
    case "daily-question":
      return {
        body: "Sua pergunta diária está pronta.",
        required: true,
        view: "question"
      };
    case "feedback-sent":
      return {
        body: "Seu feedback foi enviado com sucesso.",
        required: false,
        view: "feedbacks"
      };
    case "linked":
      return {
        body: "Este dispositivo foi vinculado ao iTransform Pulse.",
        required: false,
        view: "feedbacks"
      };
  }
}
