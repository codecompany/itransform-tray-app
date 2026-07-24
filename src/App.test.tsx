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
  events: [],
  receivedFeedbackAvailable: false
};

const feedbackTaxonomy = {
  indexes: [
    { id: "ipt", key: "IPT", description: "Índice de Potencial de Transformação" },
    { id: "iat", key: "IAT", description: "Índice de Ambiente de Trabalho" }
  ],
  dimensions: [
    { id: "dimension-ipt", indexId: "ipt", indexKey: "IPT", name: "Potencial" },
    {
      id: "sub-ipt",
      indexId: "ipt",
      indexKey: "IPT",
      parentId: "dimension-ipt",
      name: "Aprendizado"
    },
    { id: "dimension-iat", indexId: "iat", indexKey: "IAT", name: "Confiança" },
    {
      id: "sub-iat",
      indexId: "iat",
      indexKey: "IAT",
      parentId: "dimension-iat",
      name: "Segurança psicológica"
    }
  ]
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
    listFeedbackTaxonomy: vi.fn().mockResolvedValue({ indexes: [], dimensions: [] }),
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

  it("keeps the daily question out of navigation and opens it only on an Electron event", async () => {
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
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
    expect(bridge.getQuestion).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Questão" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Avisos" })).not.toBeInTheDocument();

    navigate?.("question", true);
    expect(await screen.findByText("Tenho espaço para aprender com erros?")).toBeInTheDocument();
    expect(await screen.findByText("Resposta necessária")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
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

  it("lets the employee skip and returns to the regular experience", async () => {
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
          text: "Pergunta de teste?",
          choices: [{ value: "4", label: "Concordo parcialmente" }]
        }
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Enviar feedback para alguém");

    navigate?.("question", true);
    await userEvent.click(await screen.findByRole("button", { name: "Pular por agora" }));

    expect(bridge.skipQuestion).toHaveBeenCalledOnce();
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
  });

  it("shows the empty state for the daily question", async () => {
    let navigate: ((view: "question", required: boolean) => void) | undefined;
    const bridge = api({
      onNavigate: vi.fn((callback) => {
        navigate = callback;
        return () => undefined;
      })
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Enviar feedback para alguém");
    navigate?.("question", false);
    expect(await screen.findByText("Nada por enquanto")).toBeInTheDocument();
  });

  it("shows an error when the daily question cannot be loaded", async () => {
    let navigate: ((view: "question", required: boolean) => void) | undefined;
    window.pulseTray = api({
      getQuestion: vi.fn().mockRejectedValue(new Error("Serviço indisponível")),
      onNavigate: vi.fn((callback) => {
        navigate = callback;
        return () => undefined;
      })
    });
    render(<App />);
    await screen.findByText("Enviar feedback para alguém");
    navigate?.("question", false);
    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço indisponível");
  });

  it("keeps the selected answer available when submission fails", async () => {
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
          text: "Pergunta de teste?",
          choices: [{ value: "4", label: "Concordo parcialmente" }]
        }
      }),
      submitAnswer: vi.fn().mockRejectedValue(new Error("Tente novamente"))
    });
    window.pulseTray = bridge;
    render(<App />);
    await screen.findByText("Enviar feedback para alguém");
    navigate?.("question", true);
    const choice = await screen.findByRole("radio", { name: /Concordo parcialmente/ });
    await userEvent.click(choice);
    await userEvent.click(screen.getByRole("button", { name: "Confirmar resposta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tente novamente");
    expect(choice).toHaveAttribute("aria-checked", "true");
  });

  it("opens feedback from the completed daily question", async () => {
    let navigate: ((view: "question", required: boolean) => void) | undefined;
    window.pulseTray = api({
      onNavigate: vi.fn((callback) => {
        navigate = callback;
        return () => undefined;
      }),
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: true,
        answerStatus: "external",
        question: { id: "question-1", text: "Respondida", choices: [] }
      })
    });
    render(<App />);
    await screen.findByText("Enviar feedback para alguém");
    navigate?.("question", false);
    await userEvent.click(await screen.findByRole("button", { name: "Enviar feedback" }));
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
  });

  it("requires employee, index, dimension and subdimension in that order", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      listFeedbackTaxonomy: vi.fn().mockResolvedValue(feedbackTaxonomy)
    });
    window.pulseTray = bridge;
    render(<App />);

    const search = await screen.findByLabelText("Nome ou e-mail do colaborador");
    expect(screen.queryByLabelText("Índice")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
    expect(bridge.listFeedbackTaxonomy).not.toHaveBeenCalled();

    await userEvent.click(search);
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));

    expect(await screen.findByLabelText("Índice")).toBeInTheDocument();
    expect(screen.queryByLabelText("Dimensão")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subdimensão")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
    expect(bridge.listFeedbackTaxonomy).toHaveBeenCalledOnce();

    await userEvent.selectOptions(screen.getByLabelText("Índice"), "ipt");
    expect(await screen.findByLabelText("Dimensão")).toBeInTheDocument();
    expect(screen.queryByLabelText("Subdimensão")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Dimensão"), "dimension-ipt");
    expect(await screen.findByLabelText("Subdimensão")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Subdimensão"), "sub-ipt");
    expect(await screen.findByLabelText("Mensagem")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Índice"), "iat");
    expect(screen.getByLabelText("Dimensão")).toHaveValue("");
    expect(screen.queryByLabelText("Subdimensão")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
  });

  it("keeps employee directory and dimension failures independent and retryable", async () => {
    const listEmployees = vi.fn()
      .mockRejectedValueOnce(new Error("Diretório indisponível"))
      .mockResolvedValueOnce([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]);
    const listFeedbackTaxonomy = vi.fn()
      .mockRejectedValueOnce(new Error("Subdimensões indisponíveis"))
      .mockResolvedValueOnce(feedbackTaxonomy);
    window.pulseTray = api({ listEmployees, listFeedbackTaxonomy });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Diretório indisponível");
    await userEvent.click(screen.getByRole("button", { name: "Tentar carregar colaboradores novamente" }));
    const search = await screen.findByLabelText("Nome ou e-mail do colaborador");
    await userEvent.click(search);
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Subdimensões indisponíveis");
    expect(screen.getByText("Bruno Lima")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar carregar opções novamente" }));
    expect(await screen.findByLabelText("Índice")).toBeInTheDocument();
  });

  it("preserves feedback data on failure and shows the visible 400 character counter", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      listFeedbackTaxonomy: vi.fn().mockResolvedValue(feedbackTaxonomy),
      sendFeedback: vi.fn().mockRejectedValue(new Error("Falha temporária"))
    });
    window.pulseTray = bridge;
    render(<App />);
    const search = await screen.findByLabelText("Nome ou e-mail do colaborador");
    await userEvent.type(search, "bruno@example.com");
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.selectOptions(screen.getByLabelText("Índice"), "ipt");
    await userEvent.selectOptions(screen.getByLabelText("Dimensão"), "dimension-ipt");
    await userEvent.selectOptions(screen.getByLabelText("Subdimensão"), "sub-ipt");
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
      listFeedbackTaxonomy: vi.fn().mockResolvedValue(feedbackTaxonomy),
      sendFeedback
    });
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Nome ou e-mail do colaborador"), "Bruno");
    await userEvent.click(await screen.findByRole("button", { name: /Bruno Lima/ }));
    await userEvent.selectOptions(screen.getByLabelText("Índice"), "iat");
    await userEvent.selectOptions(screen.getByLabelText("Dimensão"), "dimension-iat");
    await userEvent.selectOptions(screen.getByLabelText("Subdimensão"), "sub-iat");
    await userEvent.type(screen.getByLabelText("Mensagem"), "Obrigado!");
    const submit = screen.getByRole("button", { name: "Enviar feedback" });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(sendFeedback).toHaveBeenCalledOnce();
    resolveSend?.();
    expect(await screen.findByText("Seu feedback foi enviado com sucesso!")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar outro feedback" }));
    expect(await screen.findByLabelText("Nome ou e-mail do colaborador")).toHaveValue("");
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
  });

  it("shows received feedback without an internal notification page", async () => {
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
    await userEvent.click(await screen.findByRole("button", { name: /Recebidos/ }));
    expect(await screen.findByText("Obrigado pela parceria.")).toBeInTheDocument();
    expect(screen.getByText("Bruno Lima")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Avisos/ })).not.toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole("button", { name: /Recebidos/ }));
    expect(await screen.findByText("Contrato ainda indisponível.")).toBeInTheDocument();
    rendered.unmount();

    window.pulseTray = api({ listReceivedFeedback: vi.fn().mockRejectedValue(new Error("Falha na consulta")) });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Recebidos/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha na consulta");
  });

  it("explains the automatic daily-question policy in settings", async () => {
    window.pulseTray = api();
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Ajustes/ }));
    expect(await screen.findByText("Pergunta diária automática")).toBeInTheDocument();
    expect(screen.getByText(/primeiro acesso e pela manhã/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Horário/ })).not.toBeInTheDocument();
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
