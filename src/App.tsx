import { useEffect, useState } from "react";
import logo from "./assets/logo-iTransform.png";
import FeedbackView from "./FeedbackView";
import type {
  AppView,
  DailyQuestion,
  ReceivedFeedbackResult,
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
        <span className="eyebrow">PulseTray</span>
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
                ? "O Sintonia confirmou a resposta enviada por outro canal."
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
        {required && <small>Se pular, o PulseTray perguntará novamente mais tarde.</small>}
      </div>
    </Page>
  );
}

function ReceivedView(): JSX.Element {
  const [result, setResult] = useState<ReceivedFeedbackResult>();
  const [error, setError] = useState("");
  useEffect(() => {
    void window.pulseTray.listReceivedFeedback().then(setResult).catch((reason) => setError(messageOf(reason)));
  }, []);
  if (!result && !error) return <PanelLoading label="Buscando feedbacks…" />;
  return (
    <Page title="Feedbacks recebidos">
      {error && <ErrorNotice message={error} />}
      {result && !result.available && (
        <Empty icon="↙" title="Histórico ainda indisponível" text={result.message ?? "Tente novamente mais tarde."} />
      )}
      {result?.feedbacks.map((feedback) => (
        <article className="history-card" key={feedback.id}>
          <div><strong>{feedback.sender ?? "Anônimo"}</strong><time>{dateLabel(feedback.date)}</time></div>
          <span>{feedback.subDimension} · importância {feedback.importance}</span>
          <p>{feedback.message}</p>
        </article>
      ))}
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

  async function logout(): Promise<void> {
    if (!window.confirm("Deseja desvincular este dispositivo?")) return;
    onChange(await window.pulseTray.logout());
  }

  return (
    <Page title="Configurações">
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
        <strong>Pergunta diária automática</strong>
        <p>
          O PulseTray verifica a pergunta no primeiro acesso e pela manhã. Se você pular,
          ele perguntará novamente mais tarde.
        </p>
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

const navigation: Array<{ view: AppView; symbol: string; label: string }> = [
  { view: "feedback", symbol: "+", label: "Feedback" },
  { view: "received", symbol: "↙", label: "Recebidos" },
  { view: "settings", symbol: "⚙", label: "Ajustes" }
];

export default function App(): JSX.Element {
  const [session, setSession] = useState<SessionView>();
  const [view, setView] = useState<AppView>("feedback");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.pulseTray.bootstrap().then(setSession).catch((reason) => setError(messageOf(reason)));
    return window.pulseTray.onNavigate((next, isRequired) => {
      setRequired(isRequired);
      setView(isRequired ? "question" : next);
    });
  }, []);

  if (error) return <main className="fatal"><ErrorNotice message={error} /></main>;
  if (!session) return <PanelLoading label="Abrindo o PulseTray…" />;
  if (!session.linked) return <TokenScreen onLinked={setSession} />;

  if (view === "question") {
    return (
      <main className={`question-stage ${required ? "required" : ""}`}>
        <div className="question-stage-panel">
          <img src={logo} className="question-logo" alt="iTransform" />
          <QuestionView
            required={required}
            onAnswered={(next) => {
              setSession(next);
              setRequired(false);
            }}
            onSkipped={(next) => {
              setSession(next);
              setRequired(false);
              setView("feedback");
            }}
            openFeedback={() => setView("feedback")}
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
          {navigation.map((item) => (
            <button
              key={item.view}
              className={view === item.view ? "active" : ""}
              onClick={() => setView(item.view)}
              title={item.label}
            >
              <span>{item.symbol}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="user-mini" title={session.profile?.name}>
          {session.profile?.name.slice(0, 1).toUpperCase()}
        </div>
      </aside>
      <main className="content">
        {view === "feedback" && <FeedbackView />}
        {view === "received" && <ReceivedView />}
        {view === "settings" && <SettingsView session={session} onChange={setSession} />}
      </main>
    </div>
  );
}
