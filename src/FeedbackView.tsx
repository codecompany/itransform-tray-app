import { useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "./async";
import type {
  EmployeeOption,
  FeedbackContent,
  FeedbackDraft,
  FeedbackMethod,
  SessionView
} from "./contracts";

const maxFieldLength = 600;

type WizardStep = "recipient" | "method" | "evidence" | "guidance" | "review";

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

function newDraft(): FeedbackDraft {
  return {
    toEmployeeId: "",
    method: "",
    importance: 0,
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
  rows = 3,
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
  const helpId = `${id}-help`;
  const countId = `${id}-count`;
  return (
    <div className="field guided-field">
      <div className="label-row">
        <label htmlFor={id}>{label}{required ? " *" : ""}</label>
        <span id={countId}>{value.length}/{maxFieldLength}</span>
      </div>
      <small id={helpId}>{guidance}</small>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxFieldLength}
        rows={rows}
        placeholder={`Ex.: ${example}`}
        required={required}
        aria-describedby={`${helpId} ${countId}`}
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

const steps: WizardStep[] = ["recipient", "method", "evidence", "guidance", "review"];

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
        description: "Selecione a estrutura que combina melhor com o que você quer dizer."
      };
    case "evidence":
      return method === "development"
        ? {
            title: "Registre as evidências",
            description: "Descreva fatos que sustentam suas orientações."
          }
        : {
            title: "Descreva a situação",
            description: "Registre o contexto e o comportamento observado."
          };
    case "guidance":
      return method === "development"
        ? {
            title: "Oriente o desenvolvimento",
            description: "Preencha ao menos uma ação: continuar, começar ou parar."
          }
        : {
            title: "Explique o impacto",
            description: "Mostre o efeito observado e sugira um próximo passo."
          };
    case "review":
      return {
        title: "Revise e conclua",
        description: "Escolha a importância e confira todo o conteúdo antes de enviar."
      };
  }
}

function contentIsDirty(content: FeedbackContent): boolean {
  return Object.values(content).some((value) => value.trim());
}

function draftForSubmission(draft: FeedbackDraft): FeedbackDraft {
  return {
    ...draft,
    content: draft.method === "situational"
      ? {
          ...draft.content,
          continueDoing: "",
          startDoing: "",
          stopDoing: ""
        }
      : {
          ...draft.content,
          observedBehavior: "",
          perceivedImpact: "",
          suggestedNextStep: ""
        }
  };
}

function moveRadio(
  event: React.KeyboardEvent<HTMLButtonElement>,
  values: readonly string[],
  current: string,
  select: (value: string) => void
): void {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
  if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? values.length - 1
      : (currentIndex + (forward ? 1 : -1) + values.length) % values.length;
  const next = values[nextIndex];
  select(next);
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-radio-value="${next}"]`)?.focus();
  });
}

export default function FeedbackView({
  embedded = false,
  initialRecipientId,
  onSent,
  onCancel
}: {
  embedded?: boolean;
  initialRecipientId?: string;
  onSent?: (session: SessionView) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<FeedbackDraft>(() => newDraft());
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeEmployeeIndex, setActiveEmployeeIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const initialRecipientAppliedRef = useRef(false);

  async function loadEmployees(): Promise<void> {
    setDirectoryLoading(true);
    setDirectoryError("");
    try {
      setEmployees(await withTimeout(
        window.pulseTray.listEmployees(),
        "A lista de colaboradores demorou para responder. Tente novamente."
      ));
    } catch (reason) {
      setDirectoryError(messageOf(reason));
    } finally {
      setDirectoryLoading(false);
    }
  }

  useEffect(() => {
    void loadEmployees();
  }, []);

  useEffect(() => {
    if (
      !initialRecipientId ||
      directoryLoading ||
      directoryError ||
      initialRecipientAppliedRef.current
    ) {
      return;
    }
    initialRecipientAppliedRef.current = true;
    const employee = employees.find((candidate) => candidate.id === initialRecipientId);
    if (employee) selectEmployee(employee);
  }, [directoryError, directoryLoading, employees, initialRecipientId]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex, sent]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const matches = normalized
      ? employees.filter((employee) =>
          `${employee.name} ${employee.email}`.toLocaleLowerCase("pt-BR").includes(normalized)
        )
      : employees;
    return matches.slice(0, 8);
  }, [employees, query]);

  useEffect(() => {
    setActiveEmployeeIndex(filtered.length > 0 ? 0 : -1);
  }, [query, filtered.length]);

  useEffect(() => {
    if (!searchOpen || activeEmployeeIndex < 0) return;
    requestAnimationFrame(() => {
      document.getElementById(`employee-option-${filtered[activeEmployeeIndex]?.id}`)
        ?.scrollIntoView?.({ block: "nearest" });
    });
  }, [activeEmployeeIndex, filtered, searchOpen]);

  const selectedEmployee = employees.find((employee) => employee.id === draft.toEmployeeId);
  const currentStep = steps[stepIndex];
  const heading = stepHeading(currentStep, draft.method);
  const hasDevelopmentAction = Boolean(
    draft.content.continueDoing.trim() ||
    draft.content.startDoing.trim() ||
    draft.content.stopDoing.trim()
  );
  const hasSituationalEvidence = Boolean(
    draft.content.context.trim() && draft.content.observedBehavior.trim()
  );
  const hasSituationalGuidance = Boolean(
    draft.content.perceivedImpact.trim() && draft.content.suggestedNextStep.trim()
  );
  const hasDevelopmentEvidence = Boolean(draft.content.context.trim());
  const hasRequiredContent = draft.method === "situational"
    ? hasSituationalEvidence && hasSituationalGuidance
    : hasDevelopmentEvidence && hasDevelopmentAction;
  const canSubmit = Boolean(
    selectedEmployee &&
    draft.method &&
    hasRequiredContent &&
    draft.importance >= 1 &&
    draft.importance <= 5
  );
  const canAdvance = currentStep === "recipient"
    ? Boolean(selectedEmployee)
    : currentStep === "method"
      ? Boolean(draft.method)
      : currentStep === "evidence"
        ? draft.method === "situational" ? hasSituationalEvidence : hasDevelopmentEvidence
        : currentStep === "guidance"
          ? draft.method === "situational" ? hasSituationalGuidance : hasDevelopmentAction
          : canSubmit;
  const dirty = Boolean(
    draft.toEmployeeId || draft.method || draft.importance || contentIsDirty(draft.content)
  );

  useEffect(() => {
    window.pulseTray.setRestartBlocker(
      "feedback-form",
      dirty || busy || confirmationPending
    );
    return () => window.pulseTray.setRestartBlocker("feedback-form", false);
  }, [dirty, busy, confirmationPending]);

  function selectEmployee(employee: EmployeeOption): void {
    setDraft((current) => ({ ...current, toEmployeeId: employee.id }));
    setRequestId(crypto.randomUUID());
    setQuery(employee.name);
    setSearchOpen(false);
    setActiveEmployeeIndex(-1);
    setSubmitError("");
  }

  function clearEmployee(): void {
    setDraft((current) => ({ ...current, toEmployeeId: "" }));
    setRequestId(crypto.randomUUID());
    setQuery("");
    setSubmitError("");
    setSearchOpen(false);
  }

  function chooseMethod(method: FeedbackMethod): void {
    setDraft((current) => ({ ...current, method }));
    setRequestId(crypto.randomUUID());
    setSubmitError("");
  }

  function updateContent(field: keyof FeedbackContent, value: string): void {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, [field]: value }
    }));
    setRequestId(crypto.randomUUID());
  }

  function setImportance(value: number): void {
    setDraft((current) => ({ ...current, importance: value }));
    setRequestId(crypto.randomUUID());
  }

  async function submit(): Promise<void> {
    if (busy || !canSubmit) return;
    setBusy(true);
    setSubmitError("");
    try {
      onSent?.(await withTimeout(
        window.pulseTray.sendFeedback(draftForSubmission(draft), requestId),
        "Ainda estamos confirmando o envio. Seu texto foi preservado; verifique novamente."
      ));
      setConfirmationPending(false);
      setSent(true);
    } catch (reason) {
      const message = messageOf(reason);
      setSubmitError(message);
      setConfirmationPending(message.startsWith("Ainda estamos confirmando"));
    } finally {
      setBusy(false);
    }
  }

  function goNext(): void {
    if (!canAdvance || stepIndex >= steps.length - 1) return;
    setSubmitError("");
    setConfirmationPending(false);
    setStepIndex((current) => current + 1);
  }

  function goPrevious(): void {
    if (stepIndex === 0) return;
    setSubmitError("");
    setStepIndex((current) => current - 1);
  }

  function reset(): void {
    setDraft(newDraft());
    setQuery("");
    setSearchOpen(false);
    setActiveEmployeeIndex(-1);
    setSubmitError("");
    setStepIndex(0);
    setRequestId(crypto.randomUUID());
  }

  function cancel(): void {
    if (dirty && !window.confirm("Cancelar este feedback? O conteúdo preenchido será descartado.")) {
      return;
    }
    reset();
    onCancel?.();
  }

  function goToStep(step: WizardStep): void {
    setStepIndex(steps.indexOf(step));
  }

  function handleEmployeeKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setSearchOpen(false);
      setActiveEmployeeIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      if (!filtered.length) return;
      setActiveEmployeeIndex((current) => {
        const start = current < 0 ? 0 : current;
        return (start + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === "Enter" && searchOpen && activeEmployeeIndex >= 0) {
      event.preventDefault();
      const employee = filtered[activeEmployeeIndex];
      if (employee) selectEmployee(employee);
    }
  }

  const reviewEntries: Array<{
    step: WizardStep;
    label: string;
    value: string;
  }> = draft.method === "situational"
    ? [
        { step: "evidence" as WizardStep, label: "Contexto", value: draft.content.context },
        { step: "evidence" as WizardStep, label: "Comportamento observado", value: draft.content.observedBehavior },
        { step: "guidance" as WizardStep, label: "Impacto percebido", value: draft.content.perceivedImpact },
        { step: "guidance" as WizardStep, label: "Próximo passo", value: draft.content.suggestedNextStep }
      ]
    : [
        { step: "evidence" as WizardStep, label: "Contexto", value: draft.content.context },
        { step: "guidance" as WizardStep, label: "Continuar fazendo", value: draft.content.continueDoing },
        { step: "guidance" as WizardStep, label: "Começar a fazer", value: draft.content.startDoing },
        { step: "guidance" as WizardStep, label: "Parar de fazer", value: draft.content.stopDoing }
      ].filter(({ value }) => value.trim());

  if (sent) {
    return (
      <section className={embedded ? "feedback-pane" : "page"} aria-live="polite">
        <div className="success-card">
          <span className="success-mark" aria-hidden="true">✓</span>
          <h2 ref={headingRef} tabIndex={-1}>Seu feedback foi enviado com sucesso!</h2>
          <button
            className="secondary"
            onClick={() => {
              reset();
              setSent(false);
              onCancel?.();
            }}
          >
            {onCancel ? "Voltar ao início" : "Enviar outro feedback"}
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
      <form
        className="feedback-form structured-feedback-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="wizard-progress-group">
          <div className="wizard-progress-copy">
            <span>Etapa {stepIndex + 1} de {steps.length}</span>
          </div>
          <div
            className="wizard-progress"
            role="progressbar"
            aria-label="Progresso do envio de feedback"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={stepIndex + 1}
          >
            <span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        <section className="wizard-stage" aria-labelledby="wizard-step-title">
          <header className="wizard-step-heading">
            <h3 id="wizard-step-title" ref={headingRef} tabIndex={-1}>{heading.title}</h3>
            <p>{heading.description}</p>
          </header>

          {currentStep === "recipient" && (
            !selectedEmployee ? (
              <div className="field recipient-search">
                <label htmlFor="employee-search">Nome ou e-mail do colaborador</label>
                <input
                  id="employee-search"
                  role="combobox"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSearchOpen(true);
                  }}
                  onClick={() => setSearchOpen(true)}
                  onKeyDown={handleEmployeeKeyDown}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Digite um nome ou e-mail existente"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={searchOpen}
                  aria-controls="employee-results"
                  aria-activedescendant={
                    searchOpen && filtered[activeEmployeeIndex]
                      ? `employee-option-${filtered[activeEmployeeIndex].id}`
                      : undefined
                  }
                />
                {directoryLoading && (
                  <small className="field-status" role="status">Carregando colaboradores…</small>
                )}
                {directoryError && (
                  <div className="field-recovery">
                    <ErrorNotice message={directoryError} />
                    <button type="button" className="secondary" onClick={() => void loadEmployees()}>
                      Tentar carregar colaboradores novamente
                    </button>
                  </div>
                )}
                {searchOpen && !directoryLoading && !directoryError && (
                  filtered.length > 0 ? (
                    <div className="search-results" id="employee-results" role="listbox">
                      {filtered.map((employee, index) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={activeEmployeeIndex === index}
                          id={`employee-option-${employee.id}`}
                          tabIndex={-1}
                          key={employee.id}
                          onMouseEnter={() => setActiveEmployeeIndex(index)}
                          onClick={() => selectEmployee(employee)}
                        >
                          <strong>{employee.name}</strong>
                          <span>
                            {employee.email}{employee.position ? ` · ${employee.position}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p
                      className="search-results search-empty"
                      id="employee-results"
                      role="status"
                      aria-live="polite"
                    >
                      Nenhum colaborador encontrado.
                    </p>
                  )
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
              <div role="radiogroup" aria-label="Formato do feedback">
                {(Object.keys(methodCopy) as FeedbackMethod[]).map((method) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.method === method}
                    tabIndex={draft.method === method || (!draft.method && method === "situational") ? 0 : -1}
                    data-radio-value={method}
                    className={draft.method === method ? "selected" : ""}
                    onKeyDown={(event) => moveRadio(
                      event,
                      ["situational", "development"],
                      draft.method || "situational",
                      (value) => chooseMethod(value as FeedbackMethod)
                    )}
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

          {currentStep === "evidence" && draft.method === "situational" && (
            <div className="wizard-writing-step field-pair">
              <GuidedField
                id="feedback-context"
                label="Contexto ou fato observado"
                guidance="Diga quando e em qual situação isso aconteceu."
                example="Na apresentação ao cliente de terça-feira…"
                value={draft.content.context}
                required
                autoFocus
                onChange={(value) => updateContent("context", value)}
              />
              <GuidedField
                id="feedback-observedBehavior"
                label="Comportamento observado"
                guidance="Descreva o que a pessoa fez ou deixou de fazer, sem julgamentos."
                example="você apresentou os riscos antes de propor a solução."
                value={draft.content.observedBehavior}
                required
                onChange={(value) => updateContent("observedBehavior", value)}
              />
              {!hasSituationalEvidence && (
                <small className="wizard-requirement">Preencha os dois campos para avançar.</small>
              )}
            </div>
          )}

          {currentStep === "guidance" && draft.method === "situational" && (
            <div className="wizard-writing-step field-pair">
              <GuidedField
                id="feedback-perceivedImpact"
                label="Impacto percebido"
                guidance="Explique o efeito sobre pessoas, trabalho ou resultados."
                example="isso permitiu que o time decidisse com mais segurança."
                value={draft.content.perceivedImpact}
                required
                autoFocus
                onChange={(value) => updateContent("perceivedImpact", value)}
              />
              <GuidedField
                id="feedback-suggestedNextStep"
                label="Próximo passo sugerido"
                guidance="Sugira uma ação concreta para situações futuras."
                example="compartilhe esse mapa de riscos antes das próximas reuniões."
                value={draft.content.suggestedNextStep}
                required
                onChange={(value) => updateContent("suggestedNextStep", value)}
              />
              {!hasSituationalGuidance && (
                <small className="wizard-requirement">Preencha os dois campos para avançar.</small>
              )}
            </div>
          )}

          {currentStep === "evidence" && draft.method === "development" && (
            <div className="wizard-writing-step">
              <GuidedField
                id="feedback-context"
                label="Contexto ou evidências"
                guidance="Registre fatos que sustentam as orientações seguintes."
                example="Nas três últimas revisões de planejamento…"
                value={draft.content.context}
                required
                autoFocus
                rows={5}
                onChange={(value) => updateContent("context", value)}
              />
            </div>
          )}

          {currentStep === "guidance" && draft.method === "development" && (
            <div className="wizard-writing-step development-fields">
              <GuidedField
                id="feedback-continueDoing"
                label="Continuar fazendo"
                guidance="O que vale a pena manter."
                example="continue resumindo decisões ao final das reuniões."
                value={draft.content.continueDoing}
                autoFocus
                rows={2}
                onChange={(value) => updateContent("continueDoing", value)}
              />
              <GuidedField
                id="feedback-startDoing"
                label="Começar a fazer"
                guidance="Que novo comportamento ajudaria."
                example="comece a compartilhar riscos assim que forem identificados."
                value={draft.content.startDoing}
                rows={2}
                onChange={(value) => updateContent("startDoing", value)}
              />
              <GuidedField
                id="feedback-stopDoing"
                label="Parar de fazer"
                guidance="O que deveria deixar de acontecer."
                example="evite incluir prioridades sem revisar as anteriores."
                value={draft.content.stopDoing}
                rows={2}
                onChange={(value) => updateContent("stopDoing", value)}
              />
              {!hasDevelopmentAction && (
                <small className="wizard-requirement" role="status">
                  Preencha ao menos uma ação para avançar.
                </small>
              )}
            </div>
          )}

          {currentStep === "review" && selectedEmployee && draft.method && (
            <div className="wizard-review">
              <div className="review-overview">
                <button
                  type="button"
                  disabled={confirmationPending}
                  onClick={() => goToStep("recipient")}
                >
                  <span>Destinatário · Editar</span>
                  <strong>{selectedEmployee.name}</strong>
                </button>
                <button
                  type="button"
                  disabled={confirmationPending}
                  onClick={() => goToStep("method")}
                >
                  <span>Formato · Editar</span>
                  <strong>{methodCopy[draft.method].title.replace("Feedback ", "")}</strong>
                </button>
              </div>
              <fieldset className="importance">
                <legend>Importância *</legend>
                <div role="radiogroup" aria-label="Importância" aria-required="true">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      type="button"
                      role="radio"
                      aria-label={`Importância ${value} de 5`}
                      aria-checked={draft.importance === value}
                      tabIndex={draft.importance === value || (!draft.importance && value === 1) ? 0 : -1}
                      data-radio-value={String(value)}
                      className={draft.importance === value ? "selected" : ""}
                      disabled={confirmationPending}
                      onKeyDown={(event) => moveRadio(
                        event,
                        ["1", "2", "3", "4", "5"],
                        String(draft.importance || 1),
                        (next) => setImportance(Number(next))
                      )}
                      onClick={() => setImportance(value)}
                      key={value}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <small>
                  {draft.importance === 0 && "Escolha uma opção para concluir. "}
                  1 = menor importância · 5 = maior importância
                </small>
              </fieldset>
              <div className="review-content" aria-label="Conteúdo para revisão">
                {reviewEntries.map(({ step, label, value }) => (
                  <article key={label}>
                    <div>
                      <span>{label}</span>
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Editar ${label}`}
                        disabled={confirmationPending}
                        onClick={() => goToStep(step)}
                      >
                        Editar
                      </button>
                    </div>
                    <p>{value}</p>
                  </article>
                ))}
              </div>
              {submitError && <ErrorNotice message={submitError} />}
            </div>
          )}
        </section>

        <footer className="wizard-actions">
          <div className="wizard-secondary-actions">
            <button
              type="button"
              className="text-button"
              onClick={cancel}
              disabled={busy || confirmationPending}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="secondary"
              onClick={goPrevious}
              disabled={stepIndex === 0 || busy || confirmationPending}
            >
              Anterior
            </button>
          </div>
          {currentStep === "review" ? (
            <button
              type="button"
              className="primary"
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
            >
              {busy ? "Enviando…" : confirmationPending ? "Verificar" : "Concluir"}
            </button>
          ) : (
            <button type="button" className="primary" onClick={goNext} disabled={!canAdvance || busy}>
              Próximo
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}
