import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    deferQuestion: vi.fn().mockResolvedValue(linkedSession),
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

async function selectRecipient(name = "Bruno Lima"): Promise<void> {
  await userEvent.click(await screen.findByLabelText("Nome ou e-mail do colaborador"));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

async function nextStep(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Próximo" }));
}

async function chooseMethod(name: "situacional" | "desenvolvimento"): Promise<void> {
  await nextStep();
  await userEvent.click(screen.getByRole("radio", {
    name: name === "situacional"
      ? /Feedback situacional/
      : /Feedback de desenvolvimento/
  }));
  await nextStep();
}

async function fillStep(label: string, value: string): Promise<void> {
  await userEvent.type(screen.getByRole("textbox", { name: label }), value);
  await nextStep();
}

async function fillSituationalFeedback(): Promise<void> {
  await userEvent.type(
    screen.getByRole("textbox", { name: "Contexto ou fato observado *" }),
    "Na retrospectiva"
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Comportamento observado *" }),
    "Você trouxe exemplos"
  );
  await nextStep();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Impacto percebido *" }),
    "A conversa ficou objetiva"
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Próximo passo sugerido *" }),
    "Repita o formato"
  );
  await nextStep();
}

async function fillDevelopmentFeedback(action = "Continue resumindo decisões"): Promise<void> {
  await fillStep("Contexto ou evidências *", "Nas últimas entregas");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Continuar fazendo" }),
    action
  );
  await nextStep();
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
    await userEvent.click(await screen.findByRole("button", { name: "Solicitar token" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "Solicitar token" }));
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
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar token" }));
    expect(input).toHaveAttribute("type", "text");
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
    expect(bridge.submitAnswer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar resposta" }));
    expect(bridge.submitAnswer).toHaveBeenCalledWith({
      questionId: "question-1",
      value: "5",
      date: "2026-07-23"
    });
    expect(await screen.findByText("A pergunta de hoje já foi respondida.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar feedback" })).not.toBeInTheDocument();
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

  it("shows that no daily question is available", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    window.pulseTray = api();
    render(<App />);
    expect(await screen.findByText("Não há pergunta disponível para hoje.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar questão diária" })).toBeInTheDocument();
  });

  it("keeps a failed required question recoverable without trapping the user", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    const bridge = api({
      getQuestion: vi.fn()
        .mockRejectedValueOnce(new Error("Serviço indisponível"))
        .mockResolvedValueOnce(null)
    });
    window.pulseTray = bridge;
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Serviço indisponível");
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lembrar mais tarde" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Não há pergunta disponível para hoje.")).toBeInTheDocument();
  });

  it("defers a failed required question for a later retry", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    const bridge = api({
      getQuestion: vi.fn().mockRejectedValue(new Error("Serviço indisponível"))
    });
    window.pulseTray = bridge;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Lembrar mais tarde" }));
    expect(bridge.deferQuestion).toHaveBeenCalledOnce();
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

  it("supports arrow-key selection for daily question alternatives", async () => {
    window.history.replaceState({}, "", "/?surface=question");
    window.pulseTray = api({
      getQuestion: vi.fn().mockResolvedValue({
        employeeId: "employee-1",
        date: "2026-07-23",
        answered: false,
        answerStatus: "unanswered",
        question: {
          id: "question-1",
          text: "Pergunta por teclado?",
          choices: [
            { value: "1", label: "Primeira alternativa" },
            { value: "2", label: "Segunda alternativa" }
          ]
        }
      })
    });
    render(<App />);

    const first = await screen.findByRole("radio", { name: /Primeira alternativa/ });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /Segunda alternativa/ }))
      .toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Confirmar resposta" })).toBeEnabled();
  });

  it("shows only the empty message after a daily question was answered elsewhere", async () => {
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
    expect(await screen.findByText("A pergunta de hoje já foi respondida.")).toBeInTheDocument();
    expect(screen.queryByText("Obrigado por compartilhar seu pulso de hoje.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar feedback" })).not.toBeInTheDocument();
    expect(bridge.openFeedbacks).not.toHaveBeenCalled();
  });

  it("cancels and clears the feedback wizard without submitting", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ])
    });
    window.pulseTray = bridge;
    render(<App />);

    await selectRecipient();
    await chooseMethod("situacional");
    await userEvent.type(
      screen.getByLabelText("Contexto ou fato observado *"),
      "Conteúdo que deve ser descartado"
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(confirm).toHaveBeenCalledWith(
      "Cancelar este feedback? O conteúdo preenchido será descartado."
    );
    expect(await screen.findByText("Envio cancelado")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Começar novo feedback" }));
    expect(await screen.findByLabelText("Nome ou e-mail do colaborador")).toHaveValue("");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(bridge.sendFeedback).not.toHaveBeenCalled();
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
    await userEvent.click(await screen.findByRole("option", { name: /Bruno Lima/ }));

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await nextStep();
    expect(screen.getByRole("radio", { name: /Feedback situacional/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Contexto/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /Feedback situacional/ }));
    await nextStep();
    expect(await screen.findByLabelText("Contexto ou fato observado *")).toBeInTheDocument();
    expect(screen.getByLabelText("Comportamento observado *")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    await userEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(screen.getByRole("radio", { name: /Feedback situacional/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("preserves the composer when changing recipient and submits development choices", async () => {
    const bridge = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ])
    });
    window.pulseTray = bridge;
    render(<App />);

    await selectRecipient();
    await chooseMethod("situacional");
    await userEvent.type(
      screen.getByLabelText("Contexto ou fato observado *"),
      "Contexto temporário"
    );
    await userEvent.type(
      screen.getByLabelText("Comportamento observado *"),
      "Conteúdo situacional preservado apenas no rascunho"
    );
    await userEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await userEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await userEvent.click(screen.getByRole("button", { name: "Trocar" }));
    expect(screen.getByLabelText("Nome ou e-mail do colaborador")).toHaveValue("");

    await selectRecipient();
    await nextStep();
    expect(screen.getByRole("radio", { name: /Feedback situacional/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await userEvent.click(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ }));
    await nextStep();
    expect(screen.getByLabelText("Contexto ou evidências *")).toHaveValue("Contexto temporário");
    await userEvent.clear(screen.getByLabelText("Contexto ou evidências *"));
    await userEvent.type(screen.getByLabelText("Contexto ou evidências *"), "No planejamento");
    await nextStep();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Parar de fazer" }),
      "Mudar prioridades sem alinhamento"
    );
    await nextStep();
    await userEvent.click(screen.getByRole("radio", { name: "Importância 5 de 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Concluir envio" }));

    expect(bridge.sendFeedback).toHaveBeenCalledWith(expect.objectContaining({
      toEmployeeId: "employee-2",
      method: "development",
      importance: 5,
      content: expect.objectContaining({
        context: "No planejamento",
        stopDoing: "Mudar prioridades sem alinhamento",
        observedBehavior: "",
        perceivedImpact: "",
        suggestedNextStep: ""
      })
    }), expect.any(String));
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
    expect(await screen.findByRole("option", { name: /Bruno Lima/ })).toBeInTheDocument();
  });

  it("allows partial development guidance but requires at least one action", async () => {
    window.pulseTray = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ])
    });
    render(<App />);
    await selectRecipient();
    await chooseMethod("desenvolvimento");
    await fillStep("Contexto ou evidências *", "Nas últimas entregas");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Começar a fazer" }),
      "Compartilhe riscos mais cedo"
    );
    expect(screen.getByRole("button", { name: "Próximo" })).toBeEnabled();
    expect(screen.getByText("28/600")).toBeInTheDocument();
    await nextStep();
    expect(screen.getByRole("button", { name: "Concluir envio" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Importância 3 de 5" }));
    expect(screen.getByRole("button", { name: "Concluir envio" })).toBeEnabled();
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
    await selectRecipient();
    await chooseMethod("situacional");
    await fillSituationalFeedback();
    await userEvent.click(screen.getByRole("radio", { name: "Importância 3 de 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Concluir envio" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha temporária");
    const behaviorReview = screen.getByText("Comportamento observado").closest("article")!;
    await userEvent.click(within(behaviorReview).getByRole("button", {
      name: "Editar Comportamento observado"
    }));
    expect(screen.getByLabelText("Comportamento observado *")).toHaveValue("Você trouxe exemplos");
  });

  it("does not submit when advancing to the feedback review step", async () => {
    const sendFeedback = vi.fn().mockResolvedValue(linkedSession);
    window.pulseTray = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      sendFeedback
    });
    render(<App />);

    await selectRecipient();
    await chooseMethod("situacional");
    await fillSituationalFeedback();

    expect(await screen.findByRole("heading", { name: "Revise e conclua" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concluir envio" })).toBeInTheDocument();
    fireEvent.submit(document.querySelector("form")!);
    expect(sendFeedback).not.toHaveBeenCalled();
    expect(screen.queryByText("Seu feedback foi enviado com sucesso!")).not.toBeInTheDocument();
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
    await selectRecipient();
    await chooseMethod("desenvolvimento");
    await fillDevelopmentFeedback();
    await userEvent.click(screen.getByRole("radio", { name: "Importância 4 de 5" }));
    const submit = screen.getByRole("button", { name: "Concluir envio" });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(sendFeedback).toHaveBeenCalledOnce();
    resolveSend?.();
    expect(await screen.findByText("Seu feedback foi enviado com sucesso!")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar outro feedback" }));
    expect(await screen.findByLabelText("Nome ou e-mail do colaborador")).toHaveValue("");
  });

  it("reuses the same request identifier when feedback confirmation is retried", async () => {
    const sendFeedback = vi.fn()
      .mockRejectedValueOnce(new Error("Confirmação indisponível"))
      .mockResolvedValueOnce(linkedSession);
    window.pulseTray = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" }
      ]),
      sendFeedback
    });
    render(<App />);
    await selectRecipient();
    await chooseMethod("desenvolvimento");
    await fillDevelopmentFeedback();
    await userEvent.click(screen.getByRole("radio", { name: "Importância 4 de 5" }));

    await userEvent.click(screen.getByRole("button", { name: "Concluir envio" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirmação indisponível");
    await userEvent.click(screen.getByRole("button", { name: "Concluir envio" }));
    expect(await screen.findByText("Seu feedback foi enviado com sucesso!")).toBeInTheDocument();

    expect(sendFeedback).toHaveBeenCalledTimes(2);
    expect(sendFeedback.mock.calls[0][1]).toBe(sendFeedback.mock.calls[1][1]);
  });

  it("supports keyboard navigation and preserves a feedback draft across tabs", async () => {
    window.pulseTray = api({
      listEmployees: vi.fn().mockResolvedValue([
        { id: "employee-2", name: "Bruno Lima", email: "bruno@example.com", position: "Engenheiro" },
        { id: "employee-3", name: "Carla Alves", email: "carla@example.com", position: "Analista" }
      ])
    });
    render(<App />);

    const search = await screen.findByRole("combobox", {
      name: "Nome ou e-mail do colaborador"
    });
    search.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByText("Carla Alves")).toBeInTheDocument();
    await nextStep();

    const situational = screen.getByRole("radio", { name: /Feedback situacional/ });
    situational.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Feedback de desenvolvimento/ }))
      .toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowLeft}");
    await nextStep();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Contexto ou fato observado *" }),
      "Rascunho preservado"
    );

    const newTab = screen.getByRole("tab", { name: "Novo feedback" });
    newTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Enviados" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await userEvent.click(screen.getByRole("tab", { name: "Novo feedback" }));
    expect(screen.getByRole("textbox", { name: "Contexto ou fato observado *" }))
      .toHaveValue("Rascunho preservado");
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

  it("opens received feedback directly from native navigation", async () => {
    let navigate: ((view: "received-feedback", required: boolean) => void) | undefined;
    window.pulseTray = api({
      onNavigate: vi.fn((callback) => {
        navigate = callback as typeof navigate;
        return () => undefined;
      })
    });
    render(<App />);
    await screen.findByText("Enviar feedback para alguém");

    navigate?.("received-feedback", false);

    expect(await screen.findByRole("tab", { name: "Recebidos" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(await screen.findByText("Nenhum feedback recebido")).toBeInTheDocument();
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

    const managerLink = await screen.findByRole("button", {
      name: "Abrir ManagerHub no navegador"
    });
    expect(managerLink).toHaveAttribute("title", "Abrir ManagerHub no navegador");
    expect(managerLink.querySelector(".external-link-badge")).toHaveTextContent("↗");
    await userEvent.click(managerLink);
    expect(leaderBridge.openManagerHub).toHaveBeenCalledOnce();
    rendered.unmount();

    window.pulseTray = api();
    render(<App />);
    await screen.findByRole("button", { name: "Feedbacks" });
    expect(screen.queryByRole("button", {
      name: "Abrir ManagerHub no navegador"
    })).not.toBeInTheDocument();
  });

  it("recovers from bootstrap errors", async () => {
    window.pulseTray = api({
      bootstrap: vi.fn()
        .mockRejectedValueOnce("Falha ao abrir")
        .mockResolvedValueOnce(linkedSession)
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao abrir");
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Enviar feedback para alguém")).toBeInTheDocument();
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
