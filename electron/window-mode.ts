export interface QuestionWindow {
  setAlwaysOnTop(flag: boolean, level: "normal" | "floating"): void;
  setClosable(closable: boolean): void;
  setFullScreen(fullScreen: boolean): void;
  setFullScreenable(fullScreenable: boolean): void;
  setMaximizable(maximizable: boolean): void;
  setMinimizable(minimizable: boolean): void;
  setResizable(resizable: boolean): void;
  setVisibleOnAllWorkspaces(visible: boolean): void;
}

export function applyQuestionWindowMode(
  window: QuestionWindow,
  required: boolean,
  platform = process.platform
): void {
  window.setFullScreen(false);
  window.setFullScreenable(false);
  window.setMaximizable(false);
  window.setMinimizable(false);
  window.setResizable(false);
  window.setClosable(!required);
  window.setAlwaysOnTop(required, required ? "floating" : "normal");
  if (platform === "darwin") window.setVisibleOnAllWorkspaces(required);
}
