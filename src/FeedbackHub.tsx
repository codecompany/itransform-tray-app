import { useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "./async";
import FeedbackView from "./FeedbackView";
import type {
  EmployeeOption,
  FeedbackHistoryItem,
  FeedbackHistoryResult,
  SessionView
} from "./contracts";

type FeedbackTab = "home" | "sent" | "received";
type FeedbackAction = "landing" | "send" | "request";

const tabs: FeedbackTab[] = ["home", "sent", "received"];
const pageSize = 5;

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function dateLabel(value: string): string {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function shortDateLabel(value: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(new Date(value));
}

function methodLabel(feedback: FeedbackHistoryItem): string {
  if (feedback.method === "situational") return "Situacional";
  if (feedback.method === "development") return "Desenvolvimento";
  return "Feedback";
}

function historySections(feedback: FeedbackHistoryItem): Array<[string, string]> {
  const content = feedback.content;
  if (feedback.method === "situational") {
    return [
      ["Contexto", content.context],
      ["Comportamento", content.observedBehavior],
      ["Impacto", content.perceivedImpact],
      ["Próximo passo", content.suggestedNextStep]
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  }
  if (feedback.method === "development") {
    return [
      ["Contexto", content.context],
      ["Continuar", content.continueDoing],
      ["Começar", content.startDoing],
      ["Parar", content.stopDoing]
    ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  }
  return [["Feedback", feedback.message]];
}

function feedbackSummary(feedback: FeedbackHistoryItem): string {
  return historySections(feedback).find(([, value]) => value.trim())?.[1] ?? "Sem mensagem";
}

function ErrorNotice({ message }: { message: string }): JSX.Element {
  return <div className="notice error" role="alert">{message}</div>;
}

function PanelLoading({ label }: { label: string }): JSX.Element {
  return (
    <div className="panel-loading compact-loading" role="status" aria-live="polite" aria-busy="true">
      <span aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

function EmptyHistory({ direction }: { direction: "sent" | "received" }): JSX.Element {
  const sent = direction === "sent";
  return (
    <div className="empty compact-empty">
      <span aria-hidden="true">{sent ? "↗" : "↙"}</span>
      <h2>{sent ? "Nenhum feedback enviado" : "Nenhum feedback recebido"}</h2>
      <p>
        {sent
          ? "Os feedbacks que você enviar aparecerão aqui."
          : "Os feedbacks que você receber aparecerão aqui."}
      </p>
    </div>
  );
}

function HistoryView({ direction }: { direction: "sent" | "received" }): JSX.Element {
  const [result, setResult] = useState<FeedbackHistoryResult>();
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<FeedbackHistoryItem>();
  const dialogCloseRef = useRef<HTMLButtonElement>(null);

  async function load(): Promise<void> {
    setResult(undefined);
    setError("");
    setPage(0);
    setSelected(undefined);
    try {
      setResult(await withTimeout(
        window.pulseTray.listFeedbackHistory(direction),
        "O histórico demorou para responder. Tente novamente."
      ));
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  useEffect(() => {
    void load();
  }, [direction]);

  useEffect(() => {
    if (!selected) return;
    dialogCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(undefined);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  if (!result && !error) return <PanelLoading label="Buscando feedbacks…" />;
  const feedbacks = result?.feedbacks ?? [];
  const pages = Math.max(1, Math.ceil(feedbacks.length / pageSize));
  const rows = feedbacks.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <section
      className="feedback-pane feedback-history-table"
      aria-label={direction === "sent" ? "Feedbacks enviados" : "Feedbacks recebidos"}
    >
      {error && (
        <div className="field-recovery">
          <ErrorNotice message={error} />
          <button type="button" className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}
      {result && feedbacks.length === 0 && <EmptyHistory direction={direction} />}
      {feedbacks.length > 0 && (
        <>
          <div className="history-table-frame">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">{direction === "sent" ? "Destinatário" : "Remetente"}</th>
                  <th scope="col">Data</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Importância</th>
                  <th scope="col">Mensagem</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((feedback) => (
                  <tr key={feedback.id}>
                    <td>
                      <strong>{feedback.person}</strong>
                      {feedback.personEmail && <span>{feedback.personEmail}</span>}
                    </td>
                    <td><time dateTime={feedback.date}>{shortDateLabel(feedback.date)}</time></td>
                    <td>{methodLabel(feedback)}</td>
                    <td>
                      <span className="importance-badge" aria-label={`Importância ${feedback.importance} de 5`}>
                        {feedback.importance}/5
                      </span>
                    </td>
                    <td><span className="history-summary">{feedbackSummary(feedback)}</span></td>
                    <td>
                      <button
                        type="button"
                        className="table-action"
                        onClick={() => setSelected(feedback)}
                        aria-label={`Ver feedback de ${feedback.person}`}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="table-pagination" aria-label="Paginação do histórico">
            <span>{page + 1} de {pages}</span>
            <div>
              <button
                type="button"
                className="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="secondary"
                disabled={page >= pages - 1}
                onClick={() => setPage((current) => current + 1)}
              >
                Próxima
              </button>
            </div>
          </nav>
        </>
      )}
      {selected && (
        <div className="feedback-dialog-backdrop" role="presentation" onMouseDown={() => setSelected(undefined)}>
          <section
            className="feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">{methodLabel(selected)}</span>
                <h2 id="feedback-detail-title">{selected.person}</h2>
              </div>
              <button
                type="button"
                className="dialog-close"
                aria-label="Fechar detalhes"
                ref={dialogCloseRef}
                onClick={() => setSelected(undefined)}
              >
                ×
              </button>
            </header>
            <p className="feedback-detail-meta">
              {dateLabel(selected.date)} · importância {selected.importance}/5
            </p>
            <dl>
              {historySections(selected).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </section>
  );
}

function FeedbackLanding({ onAction }: { onAction: (action: FeedbackAction) => void }): JSX.Element {
  return (
    <section className="feedback-landing" aria-labelledby="feedback-start-title">
      <header>
        <span className="eyebrow">Feedback</span>
        <h2 id="feedback-start-title">O que você quer fazer?</h2>
        <p>Escolha uma ação para começar.</p>
      </header>
      <div className="feedback-actions">
        <article>
          <span className="action-icon" aria-hidden="true">↗</span>
          <div>
            <h3>Enviar feedback</h3>
            <p>Compartilhe uma percepção estruturada com alguém.</p>
          </div>
          <button type="button" className="primary" onClick={() => onAction("send")}>
            Iniciar
          </button>
        </article>
        <article>
          <span className="action-icon" aria-hidden="true">✉</span>
          <div>
            <h3>Solicitar feedback</h3>
            <p>Convide alguém por e-mail para enviar feedback a você.</p>
          </div>
          <button type="button" className="secondary" onClick={() => onAction("request")}>
            Solicitar
          </button>
        </article>
      </div>
    </section>
  );
}

function FeedbackRequestView({
  onChange,
  onCancel
}: {
  onChange: (session: SessionView) => void;
  onCancel: () => void;
}): JSX.Element {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<EmployeeOption>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function loadEmployees(): Promise<void> {
    setLoading(true);
    setDirectoryError("");
    try {
      setEmployees(await withTimeout(
        window.pulseTray.listEmployees(),
        "A lista de colaboradores demorou para responder. Tente novamente."
      ));
    } catch (reason) {
      setDirectoryError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEmployees();
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [sent]);

  useEffect(() => {
    window.pulseTray.setRestartBlocker(
      "feedback-request",
      Boolean(query.trim() || selected || busy)
    );
    return () => window.pulseTray.setRestartBlocker("feedback-request", false);
  }, [query, selected, busy]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const matches = normalized
      ? employees.filter((employee) =>
          `${employee.name} ${employee.email}`.toLocaleLowerCase("pt-BR").includes(normalized)
        )
      : employees;
    return matches.slice(0, 8);
  }, [employees, query]);

  function selectEmployee(employee: EmployeeOption): void {
    setSelected(employee);
    setQuery(employee.name);
    setSearchOpen(false);
    setSubmitError("");
    setRequestId(crypto.randomUUID());
  }

  async function submit(): Promise<void> {
    if (!selected || busy) return;
    setBusy(true);
    setSubmitError("");
    try {
      onChange(await withTimeout(
        window.pulseTray.requestFeedback(selected.id, requestId),
        "A solicitação demorou para responder. Tente novamente."
      ));
      setSent(true);
    } catch (reason) {
      setSubmitError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  if (sent && selected) {
    return (
      <section className="feedback-pane" aria-live="polite">
        <div className="success-card compact-success">
          <span className="success-mark" aria-hidden="true">✓</span>
          <h2 ref={headingRef} tabIndex={-1}>Solicitação enviada</h2>
          <p>{selected.name} receberá um e-mail solicitando feedback.</p>
          <button type="button" className="secondary" onClick={onCancel}>
            Voltar ao início
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="feedback-pane request-feedback-pane">
      <header className="page-header feedback-heading">
        <div>
          <h2 ref={headingRef} tabIndex={-1}>Solicitar feedback</h2>
          <p>Selecione quem deve receber o pedido por e-mail.</p>
        </div>
      </header>
      <form
        className="feedback-form request-feedback-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!selected ? (
          <div className="field recipient-search">
            <label htmlFor="feedback-request-employee">Nome ou e-mail do colaborador</label>
            <input
              id="feedback-request-employee"
              role="combobox"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onClick={() => setSearchOpen(true)}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
              }}
              placeholder="Digite um nome ou e-mail existente"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={searchOpen}
              aria-controls="feedback-request-results"
            />
            {loading && <small className="field-status" role="status">Carregando colaboradores…</small>}
            {directoryError && (
              <div className="field-recovery">
                <ErrorNotice message={directoryError} />
                <button type="button" className="secondary" onClick={() => void loadEmployees()}>
                  Tentar novamente
                </button>
              </div>
            )}
            {searchOpen && !loading && !directoryError && (
              filtered.length > 0 ? (
                <div className="search-results" id="feedback-request-results" role="listbox">
                  {filtered.map((employee) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      key={employee.id}
                      onClick={() => selectEmployee(employee)}
                    >
                      <strong>{employee.name}</strong>
                      <span>{employee.email}{employee.position ? ` · ${employee.position}` : ""}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="search-results search-empty" id="feedback-request-results" role="status">
                  Nenhum colaborador encontrado.
                </p>
              )
            )}
          </div>
        ) : (
          <section className="selected-recipient" aria-label="Colaborador selecionado">
            <div>
              <strong>{selected.name}</strong>
              <span>{selected.email}{selected.position ? ` · ${selected.position}` : ""}</span>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSelected(undefined);
                setQuery("");
                setSearchOpen(false);
                setSubmitError("");
                setRequestId(crypto.randomUUID());
              }}
            >
              Trocar
            </button>
          </section>
        )}
        {submitError && <ErrorNotice message={submitError} />}
        <div className="request-feedback-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!selected || busy}>
            {busy ? "Enviando…" : "Solicitar"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function FeedbackHub({
  onChange,
  requestedTab,
  requestedAction,
  requestedRecipientId
}: {
  onChange: (session: SessionView) => void;
  requestedTab: FeedbackTab;
  requestedAction?: Exclude<FeedbackAction, "landing">;
  requestedRecipientId?: string;
}): JSX.Element {
  const [tab, setTab] = useState<FeedbackTab>(requestedTab);
  const [action, setAction] = useState<FeedbackAction>(requestedAction ?? "landing");
  const tabListRef = useRef<HTMLDivElement>(null);

  function selectTab(next: FeedbackTab): void {
    setTab(next);
  }

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, current: FeedbackTab): void {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const currentIndex = tabs.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (forward ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    selectTab(next);
    requestAnimationFrame(() => {
      tabListRef.current?.querySelector<HTMLElement>(`#feedback-tab-${next}`)?.focus();
    });
  }

  const labels: Record<FeedbackTab, string> = {
    home: "Feedback",
    sent: "Enviados",
    received: "Recebidos"
  };

  return (
    <section className="page">
      <header className="page-header"><h1>Feedbacks</h1></header>
      <div
        className="tabs feedback-tabs"
        role="tablist"
        aria-label="Criar e consultar feedbacks"
        ref={tabListRef}
      >
        {tabs.map((item) => (
          <button
            type="button"
            role="tab"
            id={`feedback-tab-${item}`}
            aria-controls={`feedback-panel-${item}`}
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "active" : ""}
            onKeyDown={(event) => moveTab(event, item)}
            onClick={() => selectTab(item)}
            key={item}
          >
            {labels[item]}
          </button>
        ))}
      </div>
      <div
        id="feedback-panel-home"
        role="tabpanel"
        aria-labelledby="feedback-tab-home"
        hidden={tab !== "home"}
      >
        {action === "landing" && <FeedbackLanding onAction={setAction} />}
        {action === "send" && (
          <FeedbackView
            embedded
            initialRecipientId={requestedRecipientId}
            onSent={onChange}
            onCancel={() => setAction("landing")}
          />
        )}
        {action === "request" && (
          <FeedbackRequestView onChange={onChange} onCancel={() => setAction("landing")} />
        )}
      </div>
      <div
        id="feedback-panel-sent"
        role="tabpanel"
        aria-labelledby="feedback-tab-sent"
        hidden={tab !== "sent"}
      >
        {tab === "sent" && <HistoryView direction="sent" />}
      </div>
      <div
        id="feedback-panel-received"
        role="tabpanel"
        aria-labelledby="feedback-tab-received"
        hidden={tab !== "received"}
      >
        {tab === "received" && <HistoryView direction="received" />}
      </div>
    </section>
  );
}
