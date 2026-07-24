import { useEffect, useMemo, useState } from "react";
import type {
  EmployeeOption,
  FeedbackDimension,
  FeedbackDraft
} from "./contracts";

const emptyDraft: FeedbackDraft = {
  toEmployeeId: "",
  subDimensionId: "",
  importance: 3,
  message: ""
};

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function ErrorNotice({ message }: { message: string }): JSX.Element {
  return <div className="notice error" role="alert">{message}</div>;
}

export default function FeedbackView(): JSX.Element {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [dimensions, setDimensions] = useState<FeedbackDimension[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<FeedbackDraft>(emptyDraft);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [dimensionsLoading, setDimensionsLoading] = useState(false);
  const [dimensionsLoaded, setDimensionsLoaded] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [dimensionError, setDimensionError] = useState("");
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

  async function loadDimensions(): Promise<void> {
    setDimensionsLoading(true);
    setDimensionError("");
    try {
      setDimensions(await window.pulseTray.listFeedbackDimensions());
      setDimensionsLoaded(true);
    } catch (reason) {
      setDimensionError(messageOf(reason));
    } finally {
      setDimensionsLoading(false);
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

  function selectEmployee(employee: EmployeeOption): void {
    setDraft({ ...emptyDraft, toEmployeeId: employee.id });
    setQuery(employee.name);
    setSearchOpen(false);
    setSubmitError("");
    if (!dimensionsLoaded) void loadDimensions();
  }

  function clearEmployee(): void {
    setDraft(emptyDraft);
    setQuery("");
    setSubmitError("");
    setSearchOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSubmitError("");
    try {
      await window.pulseTray.sendFeedback(draft);
      setSent(true);
    } catch (reason) {
      setSubmitError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="page">
        <header className="page-header"><h1>Enviar feedback</h1></header>
        <div className="success-card">
          <span className="success-mark">✓</span>
          <h2>Seu feedback foi enviado com sucesso!</h2>
          <p>O Sintonia cuidará da entrega e do impacto analítico.</p>
          <button
            className="secondary"
            onClick={() => {
              setDraft(emptyDraft);
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
    <section className="page">
      <header className="page-header"><h1>Enviar feedback para alguém</h1></header>
      <form className="feedback-form" onSubmit={submit}>
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

            {dimensionsLoading && <small className="field-status" role="status">Carregando subdimensões…</small>}
            {dimensionError && (
              <div className="field-recovery">
                <ErrorNotice message={dimensionError} />
                <button type="button" className="secondary" onClick={() => void loadDimensions()}>
                  Tentar carregar subdimensões novamente
                </button>
              </div>
            )}

            {dimensionsLoaded && !dimensionsLoading && !dimensionError && (
              <>
                <div className="field">
                  <label htmlFor="dimension">Subdimensão de IPT ou IAT</label>
                  <select
                    id="dimension"
                    value={draft.subDimensionId}
                    onChange={(event) => setDraft({ ...draft, subDimensionId: event.target.value })}
                    required
                  >
                    <option value="">Selecione uma subdimensão</option>
                    {["IPT", "IAT"].map((index) => (
                      <optgroup label={index} key={index}>
                        {dimensions.filter((dimension) => dimension.indexKey === index).map((dimension) => (
                          <option value={dimension.id} key={dimension.id}>{dimension.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
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
                <div className="field">
                  <div className="label-row">
                    <label htmlFor="message">Mensagem</label>
                    <span>{draft.message.length}/400</span>
                  </div>
                  <textarea
                    id="message"
                    value={draft.message}
                    onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                    maxLength={400}
                    rows={5}
                    placeholder="Escreva uma mensagem clara e respeitosa."
                    required
                  />
                </div>
                {submitError && <ErrorNotice message={submitError} />}
                <button
                  className="primary"
                  disabled={busy || !draft.subDimensionId || !draft.message.trim()}
                >
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
