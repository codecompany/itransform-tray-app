import { useEffect, useMemo, useState } from "react";
import type {
  EmployeeOption,
  FeedbackContent,
  FeedbackDraft,
  FeedbackMethod,
  SessionView
} from "./contracts";

const maxFieldLength = 600;

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
  rows = 3,
  onChange
}: {
  id: string;
  label: string;
  guidance: string;
  example: string;
  value: string;
  required?: boolean;
  rows?: number;
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
        {!selectedEmployee ? (
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
          <>
            <section className="selected-recipient" aria-label="Colaborador selecionado">
              <div>
                <strong>{selectedEmployee.name}</strong>
                <span>{selectedEmployee.email}{selectedEmployee.position ? ` · ${selectedEmployee.position}` : ""}</span>
              </div>
              <button type="button" className="text-button" onClick={clearEmployee}>Trocar</button>
            </section>

            <fieldset className="feedback-methods">
              <legend>Como você quer estruturar este feedback?</legend>
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

            {draft.method && (
              <>
                <section className="method-guidance" aria-live="polite">
                  <strong>{methodCopy[draft.method].title}</strong>
                  <span>Seja específico, respeitoso e descreva comportamentos, não características pessoais.</span>
                </section>

                <GuidedField
                  id="feedback-context"
                  label={draft.method === "situational" ? "Contexto ou fato observado" : "Contexto ou evidências"}
                  guidance={draft.method === "situational"
                    ? "Diga quando e em qual situação isso aconteceu."
                    : "Registre fatos que sustentam as orientações abaixo."}
                  example={draft.method === "situational"
                    ? "Na apresentação ao cliente de terça-feira…"
                    : "Nas três últimas revisões de planejamento…"}
                  value={draft.content.context}
                  required
                  onChange={(value) => updateContent("context", value)}
                />

                {draft.method === "situational" ? (
                  <>
                    <GuidedField
                      id="feedback-behavior"
                      label="Comportamento observado"
                      guidance="Descreva o que a pessoa fez ou deixou de fazer, sem julgamentos."
                      example="você apresentou os riscos antes de propor a solução."
                      value={draft.content.observedBehavior}
                      required
                      onChange={(value) => updateContent("observedBehavior", value)}
                    />
                    <GuidedField
                      id="feedback-impact"
                      label="Impacto percebido"
                      guidance="Explique o efeito sobre pessoas, trabalho ou resultados."
                      example="isso permitiu que o time decidisse com mais segurança."
                      value={draft.content.perceivedImpact}
                      required
                      onChange={(value) => updateContent("perceivedImpact", value)}
                    />
                    <GuidedField
                      id="feedback-next-step"
                      label="Próximo passo sugerido"
                      guidance="Sugira uma ação concreta para situações futuras."
                      example="compartilhe esse mapa de riscos antes das próximas reuniões."
                      value={draft.content.suggestedNextStep}
                      required
                      onChange={(value) => updateContent("suggestedNextStep", value)}
                    />
                  </>
                ) : (
                  <>
                    <div className="development-hint">
                      Preencha ao menos uma das três áreas abaixo. Deixe vazia qualquer área sem conteúdo relevante.
                    </div>
                    <GuidedField
                      id="feedback-continue"
                      label="Continuar fazendo"
                      guidance="Comportamentos positivos que devem ser mantidos."
                      example="continue resumindo decisões e responsáveis ao final das reuniões."
                      value={draft.content.continueDoing}
                      onChange={(value) => updateContent("continueDoing", value)}
                    />
                    <GuidedField
                      id="feedback-start"
                      label="Começar a fazer"
                      guidance="Novos comportamentos que podem melhorar os resultados."
                      example="comece a compartilhar riscos assim que forem identificados."
                      value={draft.content.startDoing}
                      onChange={(value) => updateContent("startDoing", value)}
                    />
                    <GuidedField
                      id="feedback-stop"
                      label="Parar de fazer"
                      guidance="Comportamentos que prejudicam o trabalho ou os resultados."
                      example="evite incluir novas prioridades sem revisar as anteriores."
                      value={draft.content.stopDoing}
                      onChange={(value) => updateContent("stopDoing", value)}
                    />
                  </>
                )}

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
                {submitError && <ErrorNotice message={submitError} />}
                <button className="primary" disabled={busy || !canSubmit}>
                  {busy ? "Enviando…" : "Enviar feedback"}
                </button>
              </>
            )}
          </>
        )}
      </form>
    </section>
  );
}
