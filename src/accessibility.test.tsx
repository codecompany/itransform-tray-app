import { fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PulseTrayApi, SessionView } from "./contracts";

const session: SessionView = {
  linked: true,
  configured: true,
  profile: {
    id: "employee-1",
    companyId: "company-1",
    userId: "user-1",
    name: "Ana Silva",
    email: "ana@example.com",
    position: "Designer",
    startDate: "2025-01-02"
  },
  events: [],
  receivedFeedbackAvailable: true,
  quietHours: []
};

function bridge(): PulseTrayApi {
  return {
    bootstrap: vi.fn().mockResolvedValue(session),
    requestAccess: vi.fn(),
    link: vi.fn(),
    getQuestion: vi.fn().mockResolvedValue(null),
    submitAnswer: vi.fn(),
    skipQuestion: vi.fn(),
    deferQuestion: vi.fn(),
    listEmployees: vi.fn().mockResolvedValue([
      { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
    ]),
    sendFeedback: vi.fn(),
    requestFeedback: vi.fn(),
    listFeedbackHistory: vi.fn().mockResolvedValue({ feedbacks: [] }),
    saveQuietHours: vi.fn(),
    openManagerHub: vi.fn(),
    openFeedbacks: vi.fn(),
    dismissQuestion: vi.fn(),
    logout: vi.fn(),
    onNavigate: vi.fn().mockReturnValue(() => undefined)
  };
}

describe("accessibility smoke", () => {
  it("has no automated semantic violations in the primary panel", async () => {
    window.history.replaceState({}, "", "/");
    window.pulseTray = bridge();
    render(<App />);
    await waitFor(() => expect(document.querySelector(".feedback-landing")).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLButtonElement>(".feedback-actions .primary")!);
    await waitFor(() => expect(document.querySelector(".feedback-form")).toBeTruthy());

    const result = await axe.run(document.body, {
      rules: {
        "color-contrast": { enabled: false }
      }
    });
    expect(result.violations).toEqual([]);
  });
});
