import { describe, expect, it, vi } from "vitest";
import { applyQuestionWindowMode, type QuestionWindow } from "./window-mode";

function windowDouble(): QuestionWindow {
  return {
    setAlwaysOnTop: vi.fn(),
    setClosable: vi.fn(),
    setFullScreen: vi.fn(),
    setMinimizable: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn()
  };
}

describe("question window mode", () => {
  it("enforces a full-screen, non-closable window for the scheduled question", () => {
    const window = windowDouble();

    applyQuestionWindowMode(window, true, "darwin");

    expect(window.setClosable).toHaveBeenCalledWith(false);
    expect(window.setMinimizable).toHaveBeenCalledWith(false);
    expect(window.setFullScreen).toHaveBeenCalledWith(true);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true);
  });

  it("restores the normal window after the answer is accepted", () => {
    const window = windowDouble();

    applyQuestionWindowMode(window, false, "win32");

    expect(window.setClosable).toHaveBeenCalledWith(true);
    expect(window.setMinimizable).toHaveBeenCalledWith(true);
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false, "normal");
    expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
});
