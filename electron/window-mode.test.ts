import { describe, expect, it, vi } from "vitest";
import {
  applyQuestionWindowMode,
  questionModeChanged,
  type QuestionWindow
} from "./window-mode";

function windowDouble(): QuestionWindow {
  return {
    setAlwaysOnTop: vi.fn(),
    setClosable: vi.fn(),
    setFullScreen: vi.fn(),
    setFullScreenable: vi.fn(),
    setMaximizable: vi.fn(),
    setMinimizable: vi.fn(),
    setResizable: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn()
  };
}

describe("question window mode", () => {
  it.each([
    { current: false, next: false, changed: false },
    { current: false, next: true, changed: true },
    { current: true, next: false, changed: true },
    { current: true, next: true, changed: false }
  ])(
    "reports mode transition from $current to $next as $changed",
    ({ current, next, changed }) => {
      expect(questionModeChanged(current, next)).toBe(changed);
    }
  );

  it("enforces a fixed, non-closable full-screen window", () => {
    const window = windowDouble();

    applyQuestionWindowMode(window, true, "darwin");

    expect(window.setClosable).toHaveBeenCalledWith(false);
    expect(window.setMinimizable).toHaveBeenCalledWith(false);
    expect(window.setMaximizable).toHaveBeenCalledWith(false);
    expect(window.setResizable).toHaveBeenCalledWith(false);
    expect(window.setFullScreenable).toHaveBeenCalledWith(true);
    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true);
  });

  it("releases enforcement without making the question window resizable", () => {
    const window = windowDouble();

    applyQuestionWindowMode(window, false, "win32");

    expect(window.setClosable).toHaveBeenCalledWith(true);
    expect(window.setMinimizable).toHaveBeenCalledWith(false);
    expect(window.setResizable).toHaveBeenCalledWith(false);
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false, "normal");
    expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
});
