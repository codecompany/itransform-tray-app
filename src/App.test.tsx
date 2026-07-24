import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  events: [],
  receivedFeedbackAvailable: false,
  quietHours: []
};

function api(overrides: Partial<PulseTrayApi> = {}): PulseTrayApi {
  return {
    bootstrap: vi.fn().mockResolvedValue(linkedSession),
    requestAccess: vi.fn().mockResolvedValue({
      message: "Se o e-mail estiver vinculado, o token será enviado."
    }),
    link: vi.fn().mockResolvedValue(linkedSession),
    getQuestion: vi.fn().mockResolvedValue(null),
    submitAnswer: vi.fn().mockResolvedValue({ ...linkedSession, lastAnswerDate: "2026-07-23" }),
    skipQuestion: vi.fn().mockResolvedValue(linkedSession),
    listEmployees: vi.fn().mockResolvedValue([]),
    sendFeedback: vi.fn().mockResolvedValue(linkedSession),
    listFeedbackHistory: vi.fn().mockResolvedValue({ feedbacks: [] }),
    saveQuietHours: vi.fn().mockImplementation(async (quietHours) => ({
      ...linkedSession,
      quietHours
    })),
    openManagerHub: vi.fn().mockResolvedValue(undefined),
    openFeedbacks: vi.fn().mockResolvedValue(undefined),
    dismissQuestion: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue({
      linked: false,
      configured: false,
      events: [],
      receivedFeedbackAvailable: false,
      quietHours: []
    }),
    onNavigate: vi.fn().mockReturnValue(() => undefined),
    ...overrides
  };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  window.history.replaceState({}, "", "/");
});

describe("iTransform Pulse app", () => {
  it("requests a token using the corporate email without exposing account existence", async () => {
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
    await userEvent.type(await screen.findByLabelText("E-mail corporativo"), "ANA@EXAMPLE.COM");
    await userEvent.click(screen.getByRole("button", { name: "Enviar meu token" }));
    expect(bridge.requestAccess).toHaveBeenCalledWith("ANA@EXAMPLE.COM");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se o e-mail estiver vinculado, o token será enviado."
    );
  });

  it("keeps the corporate email visible when token delivery fails", async () => {
    const bridge = api({
      bootstrap: vi.fn().mockResolvedValue({
        linked: false,
        configured: false,
        events: [],
        receivedFeedbackAvailable: false
      }),
      requestAccess: vi.fn().mockRejectedValue(new Error("Não foi possível enviar o token agora."))
    });
    window.pulseTray = bridge;
    render(<App />);
    const email = await screen.findByLabelText("E-mail corporativo");
    await userEvent.type(email, "ana@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Enviar meu token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível enviar o token agora.");
    expect(email).toHaveValue("ana@example.com");
  });

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
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
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

  it("keeps the daily question out of the regular panel navigation", async () => {
    const bridge = api();
    window.pulseTray = bridge;
    render(<App />);
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
    expect(bridge.getQuestion).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Questão" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feedbacks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustes" })).toBeInTheDocument();
  });

  it("renders the required daily question on its independent surface", async () => {
    window.history.replaceState({}, "", "/?surface=question");
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
        answerStatus: "unanswered",
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
    expect(await screen.findByText("Tenho espaço para aprender com erros?")).toBeInTheDocument();
    navigate?.("question", true);
    expect(await screen.findByText("Resposta necessária")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar questão diária" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Concordo totalmente/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar resposta" }));
    expect(bridge.submitAnswer).toHaveBeenCalledWith({
      questionId: "question-1",
      value: "5",
      date: "2026-07-23"
    });
    expect(await screen.findByText("Obrigado por compartilhar seu pulso de hoje.")).toBeInTheDocument();
    expect(screen.getByText(/sincronizada automaticamente/)).toBeInTheDocument();
  });

  it("lets the employee skip from the independent question window", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    const bridge = api({
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: false,
        answerStatus: "unanswered",
        question: {
          id: "question-1",
          text: "Pergunta de teste?",
          choices: [{ value: "4", label: "Concordo parcialmente" }]
        }
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Pergunta de teste?");
    await userEvent.click(await screen.findByRole("button", { name: "Pular por agora" }));

    expect(bridge.skipQuestion).toHaveBeenCalledOnce();
  });

  it("shows the empty state for the daily question", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    window.pulseTray = api();
    render(<App />);
    expect(await screen.findByText("Nada por enquanto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar questão diária" })).toBeInTheDocument();
  });

  it("shows an error when the daily question cannot be loaded", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    window.pulseTray = api({
      getQuestion: vi.fn().mockRejectedValue(new Error("Serviço indisponível"))
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço indisponível");
  });

  it("keeps the selected answer available when submission fails", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    const bridge = api({
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: false,
        answerStatus: "unanswered",
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
    await userEvent.click(screen.getByRole("button", { name: "Confirmar resposta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tente novamente");
    expect(choice).toHaveAttribute("aria-checked", "true");
  });

  it("opens the regular feedback panel from a completed daily question", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    const bridge = api({
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: true,
        answerStatus: "external",
        question: { id: "question-1", text: "Respondida", choices: [] }
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Enviar feedback" }));
    expect(bridge.openFeedbacks).toHaveBeenCalledOnce();
  });

  it("asks for a recipient and feedback method without exposing internal taxonomy", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ])
    });
    window.pulseTray = bridge;
    render(<App />);

    const search = await screen.findByLabelText("Nome ou e-mail do colaborador");
    expect(screen.queryByText("IPT")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dimensão")).not.toBeInTheDocument();
    await userEvent.click(search);
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));

    expect(screen.getByRole("radio", { name: /Feedback situacional/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Contexto/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /Feedback situacional/ }));
    expect(await screen.findByLabelText("Contexto ou fato observado *")).toBeInTheDocument();
    expect(screen.getByLabelText("Comportamento observado *")).toBeInTheDocument();
    expect(screen.getByLabelText("Impacto percebido *")).toBeInTheDocument();
    expect(screen.getByLabelText("Próximo passo sugerido *")).toBeInTheDocument();
  });

  it("resets the composer when changing recipient and submits development choices", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ])
    });
    window.pulseTray = bridge;
    render(<App />);

    await userEvent.click(await screen.findByLabelText("Nome ou e-mail do colaborador"));
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Feedback situacional/ }));
    await userEvent.type(screen.getByLabelText("Contexto ou fato observado *"), "Contexto temporário");
    await userEvent.click(screen.getByRole("button", { name: "Trocar" }));
    expect(screen.getByLabelText("Nome ou e-mail do colaborador")).toHaveValue("");

    await userEvent.click(screen.getByLabelText("Nome ou e-mail do colaborador"));
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ }));
    await userEvent.type(screen.getByLabelText("Contexto ou evidências *"), "No planejamento");
    await userEvent.type(screen.getByLabelText("Parar de fazer"), "Mudar prioridades sem alinhamento");
    await userEvent.click(screen.getByRole("button", { name: "Importância 5 de 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Enviar feedback" }));

    expect(bridge.sendFeedback).toHaveBeenCalledWith(expect.objectContaining({
      toEmployeeId: "employee-2",
      method: "development",
      importance: 5,
      content: expect.objectContaining({
        context: "No planejamento",
        stopDoing: "Mudar prioridades sem alinhamento"
      })
    }));
  });

  it("keeps employee directory failures retryable", async () => {
    const listEmployees = vi.fn()
      .mockRejectedValueOnce(new Error("Diretório indisponível"))
      .mockResolvedValueOnce([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]);
    window.pulseTray = api({ listEmployees });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Diretório indisponível");
    await userEvent.click(screen.getByRole("button", { name: "Tentar carregar colaboradores novamente" }));
    await userEvent.click(await screen.findByLabelText("Nome ou e-mail do colaborador"));
    expect(await screen.findByRole("button", { name: /Bruno Lima/ })).toBeInTheDocument();
  });

  it("allows partial development guidance but requires at least one action", async () => {
    window.pulseTray = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ])
    });
    render(<App />);
    await userEvent.click(await screen.findByLabelText("Nome ou e-mail do colaborador"));
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ }));
    await userEvent.type(screen.getByLabelText("Contexto ou evidências *"), "Nas últimas entregas");
    expect(screen.getByRole("button", { name: "Enviar feedback" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Começar a fazer"), "Compartilhe riscos mais cedo");
    expect(screen.getByRole("button", { name: "Enviar feedback" })).toBeEnabled();
    expect(screen.getByText("28/600")).toBeInTheDocument();
  });

  it("preserves structured fields on failure", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      sendFeedback: vi.fn().mockRejectedValue(new Error("Falha temporária"))
    });
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Nome ou e-mail do colaborador"), "Bruno");
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Feedback situacional/ }));
    await userEvent.type(screen.getByLabelText("Contexto ou fato observado *"), "Na retrospectiva");
    await userEvent.type(screen.getByLabelText("Comportamento observado *"), "Você trouxe exemplos");
    await userEvent.type(screen.getByLabelText("Impacto percebido *"), "A conversa ficou objetiva");
    await userEvent.type(screen.getByLabelText("Próximo passo sugerido *"), "Repita o formato");
    await userEvent.click(screen.getByRole("button", { name: "Enviar feedback" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha temporária");
    expect(screen.getByLabelText("Comportamento observado *")).toHaveValue("Você trouxe exemplos");
  });

  it("shows the exact success copy and prevents duplicate submits", async () => {
    let resolveSend: (() => void) | undefined;
    const sendFeedback = vi.fn(() => new Promise<SessionView>((resolve) => {
      resolveSend = () => resolve(linkedSession);
    }));
    window.pulseTray = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      sendFeedback
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Nome ou e-mail do colaborador"), "Bruno");
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ }));
    await userEvent.type(screen.getByLabelText("Contexto ou evidências *"), "Nas últimas entregas");
    await userEvent.type(screen.getByLabelText("Continuar fazendo"), "Continue resumindo decisões");
    const submit = screen.getByRole("button", { name: "Enviar feedback" });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(sendFeedback).toHaveBeenCalledOnce();
    resolveSend?.();
    expect(await screen.findByText("Seu feedback foi enviado com sucesso!")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar outro feedback" }));
    expect(await screen.findByLabelText("Nome ou e-mail do colaborador")).toHaveValue("");
  });

  it("keeps creation and server-backed histories in separate tabs", async () => {
    const listFeedbackHistory = vi.fn().mockImplementation(async (direction) => ({
      feedbacks: direction === "sent" ? [
        {
          id: "feedback-situational",
          person: "Bruno Lima",
          date: "2026-07-22T12:00:00Z",
          importance: 4,
          method: "situational",
          content: {
            context: "Durante o planejamento",
            observedBehavior: "Organizou as decisões",
            perceivedImpact: "O time ganhou clareza",
            suggestedNextStep: "Repita o resumo",
            continueDoing: "",
            startDoing: "",
            stopDoing: ""
          },
          message: ""
        },
        {
          id: "feedback-development",
          person: "Diego Melo",
          date: "2026-07-21T12:00:00Z",
          importance: 3,
          method: "development",
          content: {
            context: "Nas últimas revisões",
            observedBehavior: "",
            perceivedImpact: "",
            suggestedNextStep: "",
            continueDoing: "Antecipar os riscos",
            startDoing: "Registrar decisões",
            stopDoing: ""
          },
          message: ""
        },
        {
          id: "feedback-legacy",
          person: "Eva Dias",
          date: "2026-07-20T12:00:00Z",
          importance: 2,
          method: "legacy",
          content: {
            context: "",
            observedBehavior: "",
            perceivedImpact: "",
            suggestedNextStep: "",
            continueDoing: "",
            startDoing: "",
            stopDoing: ""
          },
          message: "Mensagem anterior"
        }
      ] : [{
        id: "feedback-received",
        person: "Camila Rocha",
        date: "2026-07-22T12:00:00Z",
        importance: 4,
        method: "situational",
        content: {
          context: "Durante o planejamento",
          observedBehavior: "Organizou as decisões",
          perceivedImpact: "O time ganhou clareza",
          suggestedNextStep: "Repita o resumo",
          continueDoing: "",
          startDoing: "",
          stopDoing: ""
        },
        message: ""
      }]
    }));
    window.pulseTray = api({ listFeedbackHistory });
    render(<App />);
    expect(await screen.findByRole("tab", { name: "Novo feedback" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.queryByText("Enviados recentemente")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Enviados" }));
    expect(await screen.findByText("Bruno Lima")).toBeInTheDocument();
    expect(screen.getByText("Organizou as decisões")).toBeInTheDocument();
    expect(screen.getByText("Antecipar os riscos")).toBeInTheDocument();
    expect(screen.getByText("Mensagem anterior")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Recebidos" }));
    expect(await screen.findByText("Camila Rocha")).toBeInTheDocument();
    expect(listFeedbackHistory).toHaveBeenCalledWith("sent");
    expect(listFeedbackHistory).toHaveBeenCalledWith("received");
  });

  it("shows empty history and query errors", async () => {
    window.pulseTray = api();
    const rendered = render(<App />);
    await userEvent.click(await screen.findByRole("tab", { name: "Recebidos" }));
    expect(await screen.findByText("Nenhum feedback recebido")).toBeInTheDocument();
    rendered.unmount();

    window.pulseTray = api({
      listFeedbackHistory: vi.fn().mockRejectedValue(new Error("Falha na consulta"))
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("tab", { name: "Recebidos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha na consulta");
  });

  it("saves multiple quiet-hour windows instead of a preferred question time", async () => {
    const bridge = api();
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Ajustes/ }));
    expect(await screen.findByText("Janelas de silêncio")).toBeInTheDocument();
    expect(screen.getByText(/não deve aparecer/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Adicionar janela/ }));
    fireEvent.change(screen.getByLabelText("Início da janela 1"), {
      target: { value: "12:00" }
    });
    fireEvent.change(screen.getByLabelText("Fim da janela 1"), {
      target: { value: "13:30" }
    });
    await userEvent.click(screen.getByRole("button", { name: /Adicionar janela/ }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar janelas" }));

    expect(bridge.saveQuietHours).toHaveBeenCalledWith([
      { start: "12:00", end: "13:30" },
      { start: "22:00", end: "07:00" }
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Janelas de silêncio salvas."
    );
  });

  it("shows ManagerHub only for leaders and opens the official address", async () => {
    const leaderSession = {
      ...linkedSession,
      profile: { ...profile, isLeader: true }
    };
    const leaderBridge = api({
      bootstrap: vi.fn().mockResolvedValue(leaderSession)
    });
    window.pulseTray = leaderBridge;
    const rendered = render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "ManagerHub" }));
    expect(leaderBridge.openManagerHub).toHaveBeenCalledOnce();
    rendered.unmount();

    window.pulseTray = api();
    render(<App />);
    await screen.findByRole("button", { name: "Feedbacks" });
    expect(screen.queryByRole("button", { name: "ManagerHub" })).not.toBeInTheDocument();
  });

  it("shows bootstrap errors", async () => {
    window.pulseTray = api({ bootstrap: vi.fn().mockRejectedValue("Falha ao abrir") });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao abrir");
  });

  it("logs out from settings", async () => {
    const bridge = api();
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Ajustes/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Fazer logout" }));
    await waitFor(() => expect(bridge.logout).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText("Token de acesso")).toBeInTheDocument();
  });
});
