import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PulseTrayApi, SessionView } from "./contracts";

const profile = {
  id: "employee-1",
  companyId: "company-1",
  userId: "user-1",
  name: "Ana Silva",
  email: "ana@example.com",
  position: "Designer",
  managerName: "Caio Souza",
  startDate: "2025-01-02T00:00:00Z"
};

const linkedSession: SessionView = {
  linked: true,
  configured: true,
  profile,
  dailyTime: "09:00",
  events: [],
  receivedFeedbackAvailable: false
};

function api(overrides: Partial<PulseTrayApi> = {}): PulseTrayApi {
  return {
    bootstrap: vi.fn().mockResolvedValue(linkedSession),
    link: vi.fn().mockResolvedValue({ ...linkedSession, configured: false, dailyTime: undefined }),
    saveDailyTime: vi.fn().mockResolvedValue(linkedSession),
    getQuestion: vi.fn().mockResolvedValue(null),
    submitAnswer: vi.fn().mockResolvedValue({ ...linkedSession, lastAnswerDate: "2026-07-23" }),
    listEmployees: vi.fn().mockResolvedValue([]),
    listFeedbackDimensions: vi.fn().mockResolvedValue([]),
    sendFeedback: vi.fn().mockResolvedValue(undefined),
    listReceivedFeedback: vi.fn().mockResolvedValue({ available: false, feedbacks: [] }),
    logout: vi.fn().mockResolvedValue({ linked: false, configured: false, events: [], receivedFeedbackAvailable: false }),
    onNavigate: vi.fn().mockReturnValue(() => undefined),
    ...overrides
  };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});

describe("PulseTray app", () => {
  it("requires the onboarding token before unlocking the app", async () => {
    const bridge = api({
      bootstrap: vi.fn().mockResolvedValue({
        linked: false,
        configured: false,
        events: [],
        receivedFeedbackAvailable: false
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    const input = await screen.findByLabelText("Token de acesso");
    await userEvent.type(input, "token-value");
    await userEvent.click(screen.getByRole("button", { name: "Vincular dispositivo" }));
    expect(bridge.link).toHaveBeenCalledWith("token-value");
    expect(await screen.findByLabelText("Horário preferido")).toBeInTheDocument();
  });

  it("keeps the token screen on validation failure and normalizes the IPC error", async () => {
    const bridge = api({
      bootstrap: vi.fn().mockResolvedValue({
        linked: false,
        configured: false,
        events: [],
        receivedFeedbackAvailable: false
      }),
      link: vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'session:link': Error: Token inválido.")
      )
    });
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Token de acesso"), "bad-token");
    await userEvent.click(screen.getByRole("button", { name: "Vincular dispositivo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Token inválido.");
    expect(screen.getByLabelText("Token de acesso")).toHaveValue("bad-token");
  });

  it("saves the preferred daily time before unlocking navigation", async () => {
    const pending = { ...linkedSession, configured: false, dailyTime: undefined };
    const bridge = api({ bootstrap: vi.fn().mockResolvedValue(pending) });
    window.pulseTray = bridge;
    render(<App />);
    const time = await screen.findByLabelText("Horário preferido");
    await userEvent.clear(time);
    await userEvent.type(time, "10:30");
    await userEvent.click(screen.getByRole("button", { name: "Começar" }));
    expect(bridge.saveDailyTime).toHaveBeenCalledWith("10:30");
    expect(await screen.findByText("Questão diária")).toBeInTheDocument();
  });

  it("reports a schedule save failure without leaving setup", async () => {
    const bridge = api({
      bootstrap: vi.fn().mockResolvedValue({ ...linkedSession, configured: false, dailyTime: undefined }),
      saveDailyTime: vi.fn().mockRejectedValue(new Error("Horário recusado"))
    });
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Começar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Horário recusado");
  });

  it("renders API choices and blocks navigation during a required question", async () => {
    let navigate: ((view: "question", required: boolean) => void) | undefined;
    const bridge = api({
      onNavigate: vi.fn((callback) => {
        navigate = callback;
        return () => undefined;
      }),
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: false,
        question: {
          id: "question-1",
          text: "Tenho espaço para aprender com erros?",
          choices: [
            { value: "1", label: "Discordo totalmente" },
            { value: "5", label: "Concordo totalmente" }
          ]
        }
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Tenho espaço para aprender com erros?");
    navigate?.("question", true);
    expect(await screen.findByText("Resposta necessária")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Feedback/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Concordo totalmente/ }));
    await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    expect(bridge.submitAnswer).toHaveBeenCalledWith({
      questionId: "question-1",
      value: "5",
      date: "2026-07-23"
    });
    expect(await screen.findByText("Obrigado por compartilhar seu pulso de hoje.")).toBeInTheDocument();
  });

  it("shows the empty state for the daily question", async () => {
    const bridge = api();
    window.pulseTray = bridge;
    render(<App />);
    expect(await screen.findByText("Nada por enquanto")).toBeInTheDocument();
  });

  it("shows an error when the daily question cannot be loaded", async () => {
    window.pulseTray = api({ getQuestion: vi.fn().mockRejectedValue(new Error("Serviço indisponível")) });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço indisponível");
  });

  it("keeps the selected answer available when submission fails", async () => {
    const bridge = api({
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: false,
        question: {
          id: "question-1",
          text: "Pergunta de teste?",
          choices: [{ value: "4", label: "Concordo parcialmente" }]
        }
      }),
      submitAnswer: vi.fn().mockRejectedValue(new Error("Tente novamente"))
    });
    window.pulseTray = bridge;
    render(<App />);
    const choice = await screen.findByRole("radio", { name: /Concordo parcialmente/ });
    await userEvent.click(choice);
    await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tente novamente");
    expect(choice).toHaveAttribute("aria-checked", "true");
  });

  it("opens feedback from the completed daily question", async () => {
    window.pulseTray = api({
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: true,
        question: { id: "question-1", text: "Respondida", choices: [] }
      })
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Enviar feedback" }));
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
  });

  it("preserves feedback data on failure and shows the visible 400 character counter", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      listFeedbackDimensions: vi.fn().mockResolvedValue([
        { id: "sub-1", indexId: "ipt", indexKey: "IPT", parentId: "parent-1", name: "Aprendizado" }
      ]),
      sendFeedback: vi.fn().mockRejectedValue(new Error("Falha temporária"))
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Feedback/ }));
    await screen.findByLabelText("Colaborador");
    await userEvent.type(screen.getByLabelText("Colaborador"), "Bruno");
    await userEvent.click(await screen.findByText("Bruno Lima"));
    await userEvent.selectOptions(screen.getByLabelText("Subdimensão de IPT ou IAT"), "sub-1");
    await userEvent.clear(screen.getByLabelText("Mensagem"));
    await userEvent.type(screen.getByLabelText("Mensagem"), "Ótima colaboração.");
    expect(screen.getByText("18/400")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar feedback" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha temporária");
    expect(screen.getByLabelText("Mensagem")).toHaveValue("Ótima colaboração.");
  });

  it("shows the exact feedback success copy and prevents duplicate submits", async () => {
    let resolveSend: (() => void) | undefined;
    const sendFeedback = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      listFeedbackDimensions: vi.fn().mockResolvedValue([
        { id: "sub-1", indexId: "iat", indexKey: "IAT", parentId: "parent-1", name: "Confiança" }
      ]),
      sendFeedback
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Feedback/ }));
    await userEvent.type(await screen.findByLabelText("Colaborador"), "Bruno");
    await userEvent.click(await screen.findByText("Bruno Lima"));
    await userEvent.selectOptions(screen.getByLabelText("Subdimensão de IPT ou IAT"), "sub-1");
    await userEvent.type(screen.getByLabelText("Mensagem"), "Obrigado!");
    const submit = screen.getByRole("button", { name: "Enviar feedback" });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(sendFeedback).toHaveBeenCalledOnce();
    resolveSend?.();
    expect(await screen.findByText("Seu feedback foi enviado com sucesso!")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar outro feedback" }));
    expect(await screen.findByLabelText("Mensagem")).toHaveValue("");
  });

  it("shows received feedback and the notification datalog", async () => {
    const bridge = api({
      bootstrap: vi.fn().mockResolvedValue({
        ...linkedSession,
        events: [{
          id: "event-1",
          kind: "feedback-sent",
          title: "Feedback enviado",
          detail: "IPT · Aprendizado · importância 5",
          at: "2026-07-23T12:00:00Z"
        }]
      }),
      listReceivedFeedback: vi.fn().mockResolvedValue({
        available: true,
        feedbacks: [{
          id: "feedback-1",
          sender: "Bruno Lima",
          date: "2026-07-22T12:00:00Z",
          subDimension: "Confiança",
          importance: 4,
          message: "Obrigado pela parceria."
        }]
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Recebidos/ }));
    expect(await screen.findByText("Obrigado pela parceria.")).toBeInTheDocument();
    expect(screen.getByText("Bruno Lima")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Avisos/ }));
    expect(await screen.findByText("Feedback enviado")).toBeInTheDocument();
  });

  it("shows explicit received-feedback unavailability and errors", async () => {
    const bridge = api({
      listReceivedFeedback: vi.fn().mockResolvedValue({
        available: false,
        feedbacks: [],
        message: "Contrato ainda indisponível."
      })
    });
    window.pulseTray = bridge;
    const rendered = render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Recebidos/ }));
    expect(await screen.findByText("Contrato ainda indisponível.")).toBeInTheDocument();
    rendered.unmount();

    window.pulseTray = api({ listReceivedFeedback: vi.fn().mockRejectedValue(new Error("Falha na consulta")) });
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Recebidos/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha na consulta");
  });

  it("updates the daily time from settings and reports save errors", async () => {
    const bridge = api();
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Ajustes/ }));
    const time = await screen.findByLabelText("Horário da pergunta diária");
    await userEvent.clear(time);
    await userEvent.type(time, "08:15");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(bridge.saveDailyTime).toHaveBeenCalledWith("08:15");
    expect(await screen.findByText("Horário atualizado.")).toBeInTheDocument();
  });

  it("shows bootstrap and settings errors", async () => {
    window.pulseTray = api({ bootstrap: vi.fn().mockRejectedValue("Falha ao abrir") });
    const rendered = render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao abrir");
    rendered.unmount();

    window.pulseTray = api({ saveDailyTime: vi.fn().mockRejectedValue(new Error("Falha ao salvar")) });
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Ajustes/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao salvar");
  });

  it("logs out from settings", async () => {
    const bridge = api();
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Questão diária");
    await userEvent.click(screen.getByRole("button", { name: /Ajustes/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Fazer logout" }));
    await waitFor(() => expect(bridge.logout).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText("Token de acesso")).toBeInTheDocument();
  });
});
