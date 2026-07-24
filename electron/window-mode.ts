export interface QuestionWindow {
  setAlwaysOnTop(flag: boolean, level: "normal" | "floating"): void;
  setClosable(closable: boolean): void;
  setFullScreen(fullScreen: boolean): void;
  setMinimizable(minimizable: boolean): void;
  setVisibleOnAllWorkspaces(visible: boolean): void;
}

export function applyQuestionWindowMode(
  window: QuestionWindow,
  required: boolean,
  platform = process.platform
): void {
  window.setClosable(!required);
  window.setMinimizable(!required);
  window.setFullScreen(required);
  window.setAlwaysOnTop(required, required ? "floating" : "normal");
  if (platform === "darwin") window.setVisibleOnAllWorkspaces(required);
}
