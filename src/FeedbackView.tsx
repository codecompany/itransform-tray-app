import { useEffect, useMemo, useState } from "react";
import type {
  EmployeeOption,
  FeedbackContent,
  FeedbackDraft,
  FeedbackMethod,
  SessionView
} from "./contracts";

const maxFieldLength = 600;

type WizardStep =
  | "recipient"
  | "method"
  | "context"
  | "observedBehavior"
  | "perceivedImpact"
  | "suggestedNextStep"
  | "continueDoing"
  | "startDoing"
  | "stopDoing"
  | "review";

type ContentStep = Exclude<WizardStep, "recipient" | "method" | "review">;

function newContent(): FeedbackContent {
  return {
    context: "",
    observedBehavior: "",
    perceivedImpact: "",
    suggestedNextStep: "",
    continueDoing: "",
    startDoing: "",
    stopDoing: ""
  };
}

function newDraft(toEmployeeId = ""): FeedbackDraft {
  return {
    toEmployeeId,
    method: "",
    importance: 3,
    content: newContent()
  };
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function ErrorNotice({ message }: { message: string }): JSX.Element {
  return <div className="notice error" role="alert">{message}</div>;
}

function GuidedField({
  id,
  label,
  guidance,
  example,
  value,
  required = false,
  rows = 5,
  autoFocus = false,
  onChange
}: {
  id: string;
  label: string;
  guidance: string;
  example: string;
  value: string;
  required?: boolean;
  rows?: number;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="field guided-field">
      <div className="label-row">
        <label htmlFor={id}>{label}{required ? " *" : ""}</label>
        <span>{value.length}/{maxFieldLength}</span>
      </div>
      <small>{guidance}</small>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxFieldLength}
        rows={rows}
        placeholder={`Ex.: ${example}`}
        required={required}
        autoFocus={autoFocus}
      />
    </div>
  );
}

const methodCopy: Record<FeedbackMethod, {
  title: string;
  description: string;
}> = {
  situational: {
    title: "Feedback situacional",
    description: "Relate uma situação, o comportamento observado, o impacto e um próximo passo."
  },
  development: {
    title: "Feedback de desenvolvimento",
    description: "Organize orientações em continuar, começar e parar, usando fatos como base."
  }
};

function wizardSteps(method: FeedbackDraft["method"]): WizardStep[] {
  const content: ContentStep[] = method === "development"
    ? ["context", "continueDoing", "startDoing", "stopDoing"]
    : ["context", "observedBehavior", "perceivedImpact", "suggestedNextStep"];
  return ["recipient", "method", ...content, "review"];
}

function contentCopy(
  step: ContentStep,
  method: FeedbackMethod
): {
  label: string;
  guidance: string;
  example: string;
  required: boolean;
} {
  if (step === "context") {
    return method === "situational"
      ? {
          label: "Contexto ou fato observado",
          guidance: "Diga quando e em qual situação isso aconteceu.",
          example: "Na apresentação ao cliente de terça-feira…",
          required: true
        }
      : {
          label: "Contexto ou evidências",
          guidance: "Registre fatos que sustentam as orientações seguintes.",
          example: "Nas três últimas revisões de planejamento…",
          required: true
        };
  }
  const copy: Record<Exclude<ContentStep, "context">, {
    label: string;
    guidance: string;
    example: string;
    required: boolean;
  }> = {
    observedBehavior: {
      label: "Comportamento observado",
      guidance: "Descreva o que a pessoa fez ou deixou de fazer, sem julgamentos.",
      example: "você apresentou os riscos antes de propor a solução.",
      required: true
    },
    perceivedImpact: {
      label: "Impacto percebido",
      guidance: "Explique o efeito sobre pessoas, trabalho ou resultados.",
      example: "isso permitiu que o time decidisse com mais segurança.",
      required: true
    },
    suggestedNextStep: {
      label: "Próximo passo sugerido",
      guidance: "Sugira uma ação concreta para situações futuras.",
      example: "compartilhe esse mapa de riscos antes das próximas reuniões.",
      required: true
    },
    continueDoing: {
      label: "Continuar fazendo",
      guidance: "Registre comportamentos positivos que devem ser mantidos, se houver.",
      example: "continue resumindo decisões e responsáveis ao final das reuniões.",
      required: false
    },
    startDoing: {
      label: "Começar a fazer",
      guidance: "Registre novos comportamentos que podem melhorar os resultados, se houver.",
      example: "comece a compartilhar riscos assim que forem identificados.",
      required: false
    },
    stopDoing: {
      label: "Parar de fazer",
      guidance: "Registre comportamentos que prejudicam o trabalho, se houver.",
      example: "evite incluir novas prioridades sem revisar as anteriores.",
      required: false
    }
  };
  return copy[step];
}

function stepHeading(step: WizardStep, method: FeedbackDraft["method"]): {
  title: string;
  description: string;
} {
  switch (step) {
    case "recipient":
      return {
        title: "Para quem é este feedback?",
        description: "Pesquise pelo nome ou e-mail corporativo."
      };
    case "method":
      return {
        title: "Escolha um formato",
        description: "O formato organiza seu relato sem expor conceitos internos."
      };
    case "review":
      return {
        title: "Revise e conclua",
        description: "Defina a importância e confira o conteúdo antes do envio."
      };
    default: {
      const copy = contentCopy(step, method || "situational");
      return {
        title: copy.label,
        description: copy.guidance
      };
    }
  }
}

export default function FeedbackView({
  embedded = false,
  onSent
}: {
  embedded?: boolean;
  onSent?: (session: SessionView) => void;
}): JSX.Element {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<FeedbackDraft>(() => newDraft());
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  async function loadEmployees(): Promise<void> {
    setDirectoryLoading(true);
    setDirectoryError("");
    try {
      setEmployees(await window.pulseTray.listEmployees());
    } catch (reason) {
      setDirectoryError(messageOf(reason));
    } finally {
      setDirectoryLoading(false);
    }
  }

  useEffect(() => {
    void loadEmployees();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const matches = normalized
      ? employees.filter((employee) =>
          `${employee.name} ${employee.email}`.toLocaleLowerCase("pt-BR").includes(normalized)
        )
      : employees;
    return matches.slice(0, 8);
  }, [employees, query]);

  const selectedEmployee = employees.find((employee) => employee.id === draft.toEmployeeId);
  const steps = useMemo(() => wizardSteps(draft.method), [draft.method]);
  const boundedStepIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[boundedStepIndex];
  const heading = stepHeading(currentStep, draft.method);
  const hasDevelopmentAction = Boolean(
    draft.content.continueDoing.trim() ||
    draft.content.startDoing.trim() ||
    draft.content.stopDoing.trim()
  );
  const canSubmit = Boolean(
    selectedEmployee &&
    draft.method &&
    draft.content.context.trim() &&
    (
      draft.method === "situational"
        ? draft.content.observedBehavior.trim() &&
          draft.content.perceivedImpact.trim() &&
          draft.content.suggestedNextStep.trim()
        : hasDevelopmentAction
    )
  );
  const canAdvance = (() => {
    switch (currentStep) {
      case "recipient":
        return Boolean(selectedEmployee);
      case "method":
        return Boolean(draft.method);
      case "context":
        return Boolean(draft.content.context.trim());
      case "observedBehavior":
        return Boolean(draft.content.observedBehavior.trim());
      case "perceivedImpact":
        return Boolean(draft.content.perceivedImpact.trim());
      case "suggestedNextStep":
        return Boolean(draft.content.suggestedNextStep.trim());
      case "stopDoing":
        return hasDevelopmentAction;
      case "review":
        return canSubmit;
      default:
        return true;
    }
  })();

  function selectEmployee(employee: EmployeeOption): void {
    setDraft(newDraft(employee.id));
    setQuery(employee.name);
    setSearchOpen(false);
    setSubmitError("");
  }

  function clearEmployee(): void {
    setDraft(newDraft());
    setQuery("");
    setSubmitError("");
    setSearchOpen(true);
    setStepIndex(0);
  }

  function chooseMethod(method: FeedbackMethod): void {
    setDraft((current) => ({
      ...current,
      method,
      content: {
        ...newContent(),
        context: current.content.context
      }
    }));
    setSubmitError("");
  }

  function updateContent(field: keyof FeedbackContent, value: string): void {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, [field]: value }
    }));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setSubmitError("");
    try {
      onSent?.(await window.pulseTray.sendFeedback(draft));
      setSent(true);
    } catch (reason) {
      setSubmitError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  function goNext(): void {
    if (!canAdvance || boundedStepIndex >= steps.length - 1) return;
    setSubmitError("");
    setStepIndex(boundedStepIndex + 1);
  }

  function goPrevious(): void {
    if (boundedStepIndex === 0) return;
    setSubmitError("");
    setStepIndex(boundedStepIndex - 1);
  }

  function goToStep(step: WizardStep): void {
    const next = steps.indexOf(step);
    if (next >= 0) setStepIndex(next);
  }

  const reviewEntries = draft.method
    ? steps
        .filter((step): step is ContentStep =>
          step !== "recipient" && step !== "method" && step !== "review"
        )
        .map((step) => ({
          step,
          label: contentCopy(step, draft.method as FeedbackMethod).label,
          value: draft.content[step]
        }))
        .filter(({ value }) => value.trim())
    : [];

  if (sent) {
    return (
      <section className={embedded ? "feedback-pane" : "page"}>
        <header className="page-header"><h2>Novo feedback</h2></header>
        <div className="success-card">
          <span className="success-mark">✓</span>
          <h2>Seu feedback foi enviado com sucesso!</h2>
          <p>A classificação acontece em segundo plano, sem interromper sua experiência.</p>
          <button
            className="secondary"
            onClick={() => {
              setDraft(newDraft());
              setQuery("");
              setSearchOpen(false);
              setSent(false);
              setStepIndex(0);
            }}
          >
            Enviar outro feedback
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={embedded ? "feedback-pane" : "page"}>
      <header className="page-header feedback-heading">
        <div>
          <h2>Enviar feedback para alguém</h2>
          <p>Use fatos observáveis e sugestões que a pessoa possa colocar em prática.</p>
        </div>
      </header>
      <form className="feedback-form structured-feedback-form" onSubmit={submit}>
        <div className="wizard-progress-group">
          <div className="wizard-progress-copy">
            <span>Etapa {boundedStepIndex + 1} de {steps.length}</span>
            <strong>{Math.round(((boundedStepIndex + 1) / steps.length) * 100)}%</strong>
          </div>
          <div
            className="wizard-progress"
            role="progressbar"
            aria-label="Progresso do envio de feedback"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={boundedStepIndex + 1}
          >
            <span style={{ width: `${((boundedStepIndex + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        <section className="wizard-stage" aria-labelledby="wizard-step-title">
          <header className="wizard-step-heading">
            <span>{draft.method && currentStep !== "method"
              ? methodCopy[draft.method].title
              : "Novo feedback"}</span>
            <h3 id="wizard-step-title">{heading.title}</h3>
            <p>{heading.description}</p>
          </header>

          {currentStep === "recipient" && (
            !selectedEmployee ? (
              <div className="field recipient-search">
                <label htmlFor="employee-search">Nome ou e-mail do colaborador</label>
                <input
                  id="employee-search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Digite um nome ou e-mail existente"
                  autoComplete="off"
                  aria-expanded={searchOpen}
                  aria-controls="employee-results"
                  autoFocus
                />
                {directoryLoading && <small className="field-status" role="status">Carregando colaboradores…</small>}
                {directoryError && (
                  <div className="field-recovery">
                    <ErrorNotice message={directoryError} />
                    <button type="button" className="secondary" onClick={() => void loadEmployees()}>
                      Tentar carregar colaboradores novamente
                    </button>
                  </div>
                )}
                {searchOpen && !directoryLoading && !directoryError && (
                  <div className="search-results" id="employee-results">
                    {filtered.length > 0 ? filtered.map((employee) => (
                      <button
                        type="button"
                        key={employee.id}
                        onClick={() => selectEmployee(employee)}
                      >
                        <strong>{employee.name}</strong>
                        <span>{employee.email}{employee.position ? ` · ${employee.position}` : ""}</span>
                      </button>
                    )) : (
                      <p className="search-empty">Nenhum colaborador encontrado.</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <section className="selected-recipient selected-recipient-wizard" aria-label="Colaborador selecionado">
                <div>
                  <strong>{selectedEmployee.name}</strong>
                  <span>{selectedEmployee.email}{selectedEmployee.position ? ` · ${selectedEmployee.position}` : ""}</span>
                </div>
                <button type="button" className="text-button" onClick={clearEmployee}>Trocar</button>
              </section>
            )
          )}

          {currentStep === "method" && (
            <fieldset className="feedback-methods">
              <legend className="sr-only">Como você quer estruturar este feedback?</legend>
              <div>
                {(Object.keys(methodCopy) as FeedbackMethod[]).map((method) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.method === method}
                    className={draft.method === method ? "selected" : ""}
                    onClick={() => chooseMethod(method)}
                    key={method}
                  >
                    <strong>{methodCopy[method].title}</strong>
                    <span>{methodCopy[method].description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {draft.method &&
            currentStep !== "recipient" &&
            currentStep !== "method" &&
            currentStep !== "review" && (
              <div className="wizard-writing-step">
                {draft.method === "development" && (
                  <div className="development-hint">
                    “Continuar”, “Começar” e “Parar” são opcionais individualmente. Preencha ao menos uma delas.
                  </div>
                )}
                <GuidedField
                  id={`feedback-${currentStep}`}
                  {...contentCopy(currentStep, draft.method)}
                  value={draft.content[currentStep]}
                  autoFocus
                  onChange={(value) => updateContent(currentStep, value)}
                />
                {currentStep === "stopDoing" && !hasDevelopmentAction && (
                  <small className="wizard-requirement" role="status">
                    Preencha ao menos uma ação de desenvolvimento para avançar.
                  </small>
                )}
              </div>
            )}

          {currentStep === "review" && selectedEmployee && draft.method && (
            <div className="wizard-review">
              <div className="review-overview">
                <button type="button" onClick={() => goToStep("recipient")}>
                  <span>Destinatário</span>
                  <strong>{selectedEmployee.name}</strong>
                </button>
                <button type="button" onClick={() => goToStep("method")}>
                  <span>Formato</span>
                  <strong>{methodCopy[draft.method].title.replace("Feedback ", "")}</strong>
                </button>
              </div>
              <fieldset className="importance">
                <legend>Importância</legend>
                <div>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      aria-label={`Importância ${value} de 5`}
                      aria-pressed={draft.importance === value}
                      className={draft.importance === value ? "selected" : ""}
                      onClick={() => setDraft({ ...draft, importance: value })}
                      key={value}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <small>1 = menor importância · 5 = maior importância</small>
              </fieldset>
              <div className="review-content" aria-label="Conteúdo para revisão">
                {reviewEntries.map(({ step, label, value }) => (
                  <button type="button" onClick={() => goToStep(step)} key={step}>
                    <span>{label}</span>
                    <p>{value}</p>
                  </button>
                ))}
              </div>
              {submitError && <ErrorNotice message={submitError} />}
            </div>
          )}
        </section>

        <footer className="wizard-actions">
          <button
            type="button"
            className="secondary"
            onClick={goPrevious}
            disabled={boundedStepIndex === 0 || busy}
          >
            Anterior
          </button>
          {currentStep === "review" ? (
            <button type="submit" className="primary" disabled={busy || !canSubmit}>
              {busy ? "Enviando…" : "Concluir envio"}
            </button>
          ) : (
            <button type="button" className="primary" onClick={goNext} disabled={!canAdvance}>
              Próximo
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}
