import { describe, expect, it, vi } from "vitest";
import { applyQuestionWindowMode, type QuestionWindow } from "./window-mode";

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
  it("enforces a fixed, non-closable window without entering full screen", () => {
    const window = windowDouble();

    applyQuestionWindowMode(window, true, "darwin");

    expect(window.setClosable).toHaveBeenCalledWith(false);
    expect(window.setMinimizable).toHaveBeenCalledWith(false);
    expect(window.setMaximizable).toHaveBeenCalledWith(false);
    expect(window.setResizable).toHaveBeenCalledWith(false);
    expect(window.setFullScreenable).toHaveBeenCalledWith(false);
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
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
