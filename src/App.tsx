import { useEffect, useState } from "react";
import logo from "./assets/logo-iTransform.png";
import FeedbackView from "./FeedbackView";
import type {
  AppView,
  DailyQuestion,
  FeedbackHistoryItem,
  FeedbackHistoryResult,
  SessionView
} from "./contracts";

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function dateLabel(value: string): string {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function ErrorNotice({ message }: { message: string }): JSX.Element {
  return <div className="notice error" role="alert">{message}</div>;
}

function TokenScreen({ onLinked }: { onLinked: (session: SessionView) => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [success, setSuccess] = useState("");

  async function requestAccess(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setRequestBusy(true);
    setRequestError("");
    setSuccess("");
    try {
      const result = await window.pulseTray.requestAccess(email);
      setSuccess(result.message);
    } catch (reason) {
      setRequestError(messageOf(reason));
    } finally {
      setRequestBusy(false);
    }
  }

  async function link(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLinkBusy(true);
    setLinkError("");
    try {
      onLinked(await window.pulseTray.link(token));
    } catch (reason) {
      setLinkError(messageOf(reason));
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <main className="welcome">
      <section className="welcome-card auth-card">
        <img src={logo} className="brand-logo" alt="iTransform" />
        <span className="eyebrow">iTransform Pulse</span>
        <h1>Seu pulso diário, sem interromper o ritmo.</h1>
        <p>Informe seu e-mail corporativo. Enviaremos um token pessoal para vincular este dispositivo.</p>
        {success ? (
          <>
            <div className="notice success" role="status">{success}</div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSuccess("");
                setRequestError("");
              }}
            >
              Solicitar novamente
            </button>
          </>
        ) : (
          <form onSubmit={requestAccess} className="stack">
            <label htmlFor="corporate-email">E-mail corporativo</label>
            <input
              id="corporate-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com"
              autoComplete="email"
              autoFocus
              required
            />
            <button className="primary" disabled={requestBusy || !email.trim()}>
              {requestBusy ? "Enviando…" : "Enviar meu token"}
            </button>
          </form>
        )}
        {requestError && <ErrorNotice message={requestError} />}
        <div className="auth-divider"><span>Já recebeu seu token?</span></div>
        <form onSubmit={link} className="stack">
          <label htmlFor="token">Token de acesso</label>
          <input
            id="token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Cole seu token aqui"
            autoComplete="off"
            required
          />
          {linkError && <ErrorNotice message={linkError} />}
          <button className="secondary" disabled={linkBusy || !token.trim()}>
            {linkBusy ? "Validando…" : "Vincular dispositivo"}
          </button>
        </form>
        <small>Seu token é pessoal e fica protegido pelo armazenamento seguro do sistema.</small>
      </section>
    </main>
  );
}

function QuestionView({
  required,
  onAnswered,
  onSkipped,
  openFeedback
}: {
  required: boolean;
  onAnswered: (session: SessionView) => void;
  onSkipped: (session: SessionView) => void;
  openFeedback: () => void;
}): JSX.Element {
  const [question, setQuestion] = useState<DailyQuestion | null>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    void window.pulseTray.getQuestion()
      .then(setQuestion)
      .catch((reason) => setError(messageOf(reason)));
  }, []);

  async function answer(): Promise<void> {
    if (!question || !selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await window.pulseTray.submitAnswer({
        questionId: question.question.id,
        value: selected,
        date: question.date
      });
      setQuestion({ ...question, answered: true, answerStatus: "pending-sync" });
      onAnswered(session);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function skip(): Promise<void> {
    if (!question || busy) return;
    setBusy(true);
    setError("");
    try {
      onSkipped(await window.pulseTray.skipQuestion());
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  if (error && !question) return <Page title="Questão diária"><ErrorNotice message={error} /></Page>;
  if (question === undefined) return <PanelLoading label="Buscando a pergunta de hoje…" />;
  if (!question) {
    return (
      <Page title="Questão diária">
        <Empty icon="○" title="Nada por enquanto" text="Ainda não há uma pergunta disponível para hoje." />
      </Page>
    );
  }
  if (question.answered) {
    const pendingSync = question.answerStatus === "pending-sync";
    const external = question.answerStatus === "external";
    return (
      <Page title="Questão diária">
        <div className="success-card">
          <span className="success-mark">✓</span>
          <span className="eyebrow">
            {pendingSync ? "Resposta salva" : external ? "Resposta já registrada" : "Resposta registrada"}
          </span>
          <h2>Obrigado por compartilhar seu pulso de hoje.</h2>
          <p>
            {pendingSync
              ? "Sua resposta está protegida neste dispositivo e será sincronizada automaticamente."
              : external
                ? "O iTransform Pulse confirmou a resposta enviada por outro canal."
                : "Você concluiu a pergunta diária. Que tal reconhecer alguém agora?"}
          </p>
          <button className="secondary" onClick={openFeedback}>Enviar feedback</button>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Questão diária" badge={required ? "Resposta necessária" : undefined}>
      <div className="question-card">
        <span className="eyebrow">{dateLabel(question.date)}</span>
        <h2>{question.question.text}</h2>
        <div className="choices" role="radiogroup" aria-label="Alternativas">
          {question.question.choices.map((choice) => (
            <button
              type="button"
              role="radio"
              aria-checked={selected === choice.value}
              className={`choice ${selected === choice.value ? "selected" : ""}`}
              key={choice.value}
              onClick={() => setSelected(choice.value)}
              disabled={busy}
            >
              <span>{choice.value}</span>
              <strong>{choice.label}</strong>
            </button>
          ))}
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="question-actions">
          <button className="primary" disabled={!selected || busy} onClick={answer}>
            {busy ? "Salvando…" : "Confirmar resposta"}
          </button>
          <button className="text-button" disabled={busy} onClick={skip}>
            Pular por agora
          </button>
        </div>
        {required && <small>Se pular, o iTransform Pulse perguntará novamente mais tarde.</small>}
      </div>
    </Page>
  );
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

function HistoryView({ direction }: { direction: "sent" | "received" }): JSX.Element {
  const [result, setResult] = useState<FeedbackHistoryResult>();
  const [error, setError] = useState("");
  useEffect(() => {
    setResult(undefined);
    setError("");
    void window.pulseTray.listFeedbackHistory(direction)
      .then(setResult)
      .catch((reason) => setError(messageOf(reason)));
  }, [direction]);
  if (!result && !error) return <PanelLoading label="Buscando feedbacks…" />;
  return (
    <section
      className="feedback-pane feedback-history"
      aria-label={direction === "sent" ? "Feedbacks enviados" : "Feedbacks recebidos"}
    >
      {error && <ErrorNotice message={error} />}
      {result?.feedbacks.length === 0 && (
        <Empty
          icon={direction === "sent" ? "↗" : "↙"}
          title={direction === "sent" ? "Nenhum feedback enviado" : "Nenhum feedback recebido"}
          text="Os feedbacks aparecerão aqui sem ocupar o espaço do formulário."
        />
      )}
      {result?.feedbacks.map((feedback) => (
        <article className="history-card" key={feedback.id}>
          <div>
            <strong>{feedback.person}</strong>
            <time>{dateLabel(feedback.date)}</time>
          </div>
          <span>
            {feedback.method === "situational"
              ? "Feedback situacional"
              : feedback.method === "development"
                ? "Feedback de desenvolvimento"
                : "Feedback"} · importância {feedback.importance}
          </span>
          <dl>
            {historySections(feedback).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </section>
  );
}

function FeedbacksView({
  onChange
}: {
  onChange: (session: SessionView) => void;
}): JSX.Element {
  const [tab, setTab] = useState<"new" | "sent" | "received">("new");
  return (
    <Page title="Feedbacks">
      <div className="tabs feedback-tabs" role="tablist" aria-label="Criar e consultar feedbacks">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "new"}
          className={tab === "new" ? "active" : ""}
          onClick={() => setTab("new")}
        >
          Novo feedback
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sent"}
          className={tab === "sent" ? "active" : ""}
          onClick={() => setTab("sent")}
        >
          Enviados
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "received"}
          className={tab === "received" ? "active" : ""}
          onClick={() => setTab("received")}
        >
          Recebidos
        </button>
      </div>
      {tab === "new" && <FeedbackView embedded onSent={onChange} />}
      {tab === "sent" && <HistoryView direction="sent" />}
      {tab === "received" && <HistoryView direction="received" />}
    </Page>
  );
}

function SettingsView({
  session,
  onChange
}: {
  session: SessionView;
  onChange: (session: SessionView) => void;
}): JSX.Element {
  const profile = session.profile!;
  const [quietHours, setQuietHours] = useState(session.quietHours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function logout(): Promise<void> {
    if (!window.confirm("Deseja desvincular este dispositivo?")) return;
    onChange(await window.pulseTray.logout());
  }

  async function saveQuietHours(): Promise<void> {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      onChange(await window.pulseTray.saveQuietHours(quietHours));
      setSaved(true);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Ajustes">
      <section className="profile-card">
        <div className="avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
        <div><strong>{profile.name}</strong><span>{profile.position}</span></div>
      </section>
      <dl className="details">
        <div><dt>User ID</dt><dd>{profile.userId}</dd></div>
        <div><dt>Gestor</dt><dd>{profile.managerName ?? "Não informado"}</dd></div>
        <div><dt>Ingresso</dt><dd>{dateLabel(profile.startDate)}</dd></div>
        <div><dt>E-mail</dt><dd>{profile.email}</dd></div>
      </dl>
      <section className="settings-form">
        <strong>Janelas de silêncio</strong>
        <p>
          Defina os períodos em que a pergunta diária não deve aparecer. Fora deles, o
          iTransform Pulse escolhe o melhor momento automaticamente.
        </p>
        <div className="quiet-hours-list">
          {quietHours.map((window, index) => (
            <div className="quiet-hours-row" key={`${index}-${window.start}-${window.end}`}>
              <label>
                <span>Início</span>
                <input
                  type="time"
                  aria-label={`Início da janela ${index + 1}`}
                  value={window.start}
                  onChange={(event) => setQuietHours(quietHours.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, start: event.target.value } : item
                  ))}
                />
              </label>
              <label>
                <span>Fim</span>
                <input
                  type="time"
                  aria-label={`Fim da janela ${index + 1}`}
                  value={window.end}
                  onChange={(event) => setQuietHours(quietHours.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, end: event.target.value } : item
                  ))}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remover janela ${index + 1}`}
                onClick={() => setQuietHours(quietHours.filter((_, itemIndex) => itemIndex !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="quiet-add"
          onClick={() => setQuietHours([...quietHours, { start: "22:00", end: "07:00" }])}
        >
          + Adicionar janela
        </button>
        {error && <ErrorNotice message={error} />}
        {saved && <div className="notice success" role="status">Janelas de silêncio salvas.</div>}
        <button type="button" className="secondary" disabled={busy} onClick={saveQuietHours}>
          {busy ? "Salvando…" : "Salvar janelas"}
        </button>
      </section>
      <button className="danger-link" onClick={logout}>Fazer logout</button>
    </Page>
  );
}

function Page({
  title,
  badge,
  children
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="page">
      <header className="page-header"><h1>{title}</h1>{badge && <span>{badge}</span>}</header>
      {children}
    </section>
  );
}

function PanelLoading({ label }: { label: string }): JSX.Element {
  return <div className="panel-loading"><span /><p>{label}</p></div>;
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }): JSX.Element {
  return <div className="empty"><span>{icon}</span><h2>{title}</h2><p>{text}</p></div>;
}

function FeedbackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16v11H9l-5 3v-14Z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function ManagerIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.4-3.5 2.2-5.2 5.5-5.2s5.1 1.7 5.5 5.2M16 8h5M18.5 5.5v5" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.7 3.5h4.6l.7 2.3 2 .9 2.2-1.1 2.3 4-1.8 1.5v2.2l1.8 1.5-2.3 4-2.2-1.1-2 .9-.7 2.3H9.7L9 18.6l-2-.9-2.2 1.1-2.3-4 1.8-1.5v-2.2L2.5 9.6l2.3-4L7 6.7l2-.9.7-2.3Z" />
      <circle cx="12" cy="12.2" r="3" />
    </svg>
  );
}

export default function App(): JSX.Element {
  const surface = new URLSearchParams(window.location.search).get("surface") === "question"
    ? "question"
    : "panel";
  const [session, setSession] = useState<SessionView>();
  const [view, setView] = useState<AppView>(
    surface === "question" ? "question" : "feedbacks"
  );
  const [required, setRequired] = useState(false);
  const [navigationKey, setNavigationKey] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.pulseTray.bootstrap().then(setSession).catch((reason) => setError(messageOf(reason)));
    return window.pulseTray.onNavigate((next, isRequired) => {
      if (surface === "question" && next !== "question") return;
      if (surface === "panel" && next === "question") return;
      void window.pulseTray.bootstrap().then(setSession).catch((reason) => setError(messageOf(reason)));
      setRequired(isRequired);
      setView(next);
      setNavigationKey((current) => current + 1);
    });
  }, [surface]);

  if (error) return <main className="fatal"><ErrorNotice message={error} /></main>;
  if (!session) return <PanelLoading label="Abrindo o iTransform Pulse…" />;
  if (!session.linked) {
    if (surface === "question") return <PanelLoading label="Aguardando a vinculação…" />;
    return <TokenScreen onLinked={setSession} />;
  }

  if (surface === "question") {
    return (
      <main className={`question-stage ${required ? "required" : ""}`} key={navigationKey}>
        <div className="question-stage-panel">
          <header className="question-window-bar">
            <img src={logo} className="question-logo" alt="iTransform" />
            {!required && (
              <button
                type="button"
                className="question-close"
                aria-label="Fechar questão diária"
                onClick={() => void window.pulseTray.dismissQuestion()}
              >
                ×
              </button>
            )}
          </header>
          <QuestionView
            required={required}
            onAnswered={(next) => {
              setSession(next);
              setRequired(false);
            }}
            onSkipped={(next) => {
              setSession(next);
              setRequired(false);
            }}
            openFeedback={() => void window.pulseTray.openFeedbacks()}
          />
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <img src={logo} alt="iTransform" />
        <nav aria-label="Navegação principal">
          <button
            className={view === "feedbacks" ? "active" : ""}
            onClick={() => setView("feedbacks")}
            title="Feedbacks"
          >
            <span><FeedbackIcon /></span>
            Feedbacks
          </button>
          {session.profile?.isLeader && (
            <button
              className="external-navigation"
              onClick={() => void window.pulseTray.openManagerHub()}
              title="Abrir ManagerHub no navegador"
              aria-label="Abrir ManagerHub no navegador"
            >
              <span>
                <ManagerIcon />
                <span className="external-link-badge" aria-hidden="true">↗</span>
              </span>
              ManagerHub
            </button>
          )}
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
            title="Ajustes"
          >
            <span><SettingsIcon /></span>
            Ajustes
          </button>
        </nav>
        <div className="user-mini" title={session.profile?.name}>
          {session.profile?.name.slice(0, 1).toUpperCase()}
        </div>
      </aside>
      <main className="content">
        {view === "feedbacks" && <FeedbacksView onChange={setSession} />}
        {view === "settings" && <SettingsView session={session} onChange={setSession} />}
      </main>
    </div>
  );
}
