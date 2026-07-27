import { useEffect, useRef, useState } from "react";
import logo from "./assets/logo-iTransform.png";
import { withTimeout } from "./async";
import FeedbackHub from "./FeedbackHub";
import type {
  AppView,
  DailyQuestion,
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
  const [mode, setMode] = useState<"token" | "request">("token");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
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
      const result = await withTimeout(
        window.pulseTray.requestAccess(email),
        "A solicitação demorou para responder. Tente novamente."
      );
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
      onLinked(await withTimeout(
        window.pulseTray.link(token),
        "A validação demorou para responder. Tente novamente."
      ));
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
        <h1>Vincule este dispositivo</h1>
        <p>
          {mode === "token"
            ? "Use o token pessoal recebido no onboarding."
            : "Informe seu e-mail corporativo para solicitar um token pessoal."}
        </p>
        <div className="tabs auth-mode" role="group" aria-label="Forma de acesso">
          <button
            type="button"
            aria-pressed={mode === "token"}
            className={mode === "token" ? "active" : ""}
            onClick={() => setMode("token")}
          >
            Tenho um token
          </button>
          <button
            type="button"
            aria-pressed={mode === "request"}
            className={mode === "request" ? "active" : ""}
            onClick={() => setMode("request")}
          >
            Solicitar token
          </button>
        </div>
        {mode === "request" && (success ? (
          <div className="stack">
            <div className="notice success" role="status">{success}</div>
            <button type="button" className="primary" onClick={() => setMode("token")}>
              Usar token recebido
            </button>
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
          </div>
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
            {requestError && <ErrorNotice message={requestError} />}
          </form>
        ))}
        {mode === "token" && (
          <form onSubmit={link} className="stack">
            <label htmlFor="token">Token de acesso</label>
            <div className="secret-input">
              <input
                id="token"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Cole seu token aqui"
                autoComplete="off"
                autoFocus
                required
              />
              <button
                type="button"
                className="text-button"
                aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                onClick={() => setShowToken((current) => !current)}
              >
                {showToken ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            {linkError && <ErrorNotice message={linkError} />}
            <button className="primary" disabled={linkBusy || !token.trim()}>
              {linkBusy ? "Validando…" : "Vincular dispositivo"}
            </button>
          </form>
        )}
        <small>Seu token é pessoal e fica protegido pelo armazenamento seguro do sistema.</small>
      </section>
    </main>
  );
}

function QuestionView({
  required,
  onAnswered,
  onSkipped
}: {
  required: boolean;
  onAnswered: (session: SessionView) => void;
  onSkipped: (session: SessionView) => void;
}): JSX.Element {
  const [question, setQuestion] = useState<DailyQuestion | null>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const questionTitleRef = useRef<HTMLHeadingElement>(null);

  async function loadQuestion(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      setQuestion(await withTimeout(
        window.pulseTray.getQuestion(),
        "A pergunta demorou para responder. Tente novamente."
      ));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQuestion();
  }, []);

  useEffect(() => {
    if (!loading && question !== undefined) {
      if (!question || question.answered) resultRef.current?.focus();
      else questionTitleRef.current?.focus();
    }
  }, [loading, question]);

  async function answer(): Promise<void> {
    if (!question || !selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await withTimeout(
        window.pulseTray.submitAnswer({
          questionId: question.question.id,
          value: selected,
          date: question.date
        }),
        "A confirmação demorou para responder. Sua seleção foi mantida; tente novamente."
      );
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
      onSkipped(await withTimeout(
        window.pulseTray.skipQuestion(),
        "Não foi possível adiar agora. Tente novamente."
      ));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function defer(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSkipped(await withTimeout(
        window.pulseTray.deferQuestion(),
        "Não foi possível adiar agora. Tente novamente."
      ));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  function handleChoiceKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (!question) return;
    const choices = question.question.choices;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.length - 1
        : (index + (forward ? 1 : -1) + choices.length) % choices.length;
    const next = choices[nextIndex];
    setSelected(next.value);
    requestAnimationFrame(() => {
      document.getElementById(`question-choice-${next.value}`)?.focus();
    });
  }

  if (loading) return <PanelLoading label="Buscando a pergunta de hoje…" />;
  if (error && !question) {
    return (
      <Page title="Questão diária">
        <div className="recovery-card">
          <ErrorNotice message={error} />
          <p>Você pode tentar buscar a pergunta novamente agora ou receber outro lembrete.</p>
          <div>
            <button type="button" className="primary" onClick={() => void loadQuestion()}>
              Tentar novamente
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void defer()}>
              {busy ? "Adiando…" : "Lembrar mais tarde"}
            </button>
          </div>
        </div>
      </Page>
    );
  }
  if (!question) {
    return (
      <Page title="Questão diária">
        <div className="empty question-empty">
          <span aria-hidden="true">✓</span>
          <h2 ref={resultRef} tabIndex={-1}>Nenhuma questão disponível</h2>
          <p>Não há uma questão para responder hoje.</p>
        </div>
      </Page>
    );
  }
  if (question.answered) {
    return (
      <Page title="Questão diária">
        <div className="empty question-empty">
          <span aria-hidden="true">✓</span>
          <h2 ref={resultRef} tabIndex={-1}>Questão concluída</h2>
          <p>A questão de hoje já foi respondida.</p>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Questão diária" badge={required ? "Resposta necessária" : undefined}>
      <div className="question-card">
        <span className="eyebrow">{dateLabel(question.date)}</span>
        <h2 ref={questionTitleRef} tabIndex={-1}>{question.question.text}</h2>
        <div className="choices" role="radiogroup" aria-label="Alternativas">
          {question.question.choices.map((choice, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={selected === choice.value}
              tabIndex={selected === choice.value || (!selected && index === 0) ? 0 : -1}
              id={`question-choice-${choice.value}`}
              className={`choice ${selected === choice.value ? "selected" : ""}`}
              key={choice.value}
              onClick={() => setSelected(choice.value)}
              onKeyDown={(event) => handleChoiceKey(event, index)}
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
  const savedQuietHours = JSON.stringify(session.quietHours);
  const dirty = JSON.stringify(quietHours) !== savedQuietHours;
  const validationError = quietHours.length > 12
    ? "Use no máximo 12 janelas de silêncio."
    : quietHours.some((window) => !window.start || !window.end || window.start === window.end)
      ? "Cada janela deve ter horários de início e fim diferentes."
      : new Set(quietHours.map((window) => `${window.start}-${window.end}`)).size !== quietHours.length
        ? "Remova as janelas de silêncio duplicadas."
        : "";

  function updateQuietHours(next: typeof quietHours): void {
    setQuietHours(next);
    setSaved(false);
    setError("");
  }

  async function logout(): Promise<void> {
    if (!window.confirm("Deseja desvincular este dispositivo?")) return;
    setBusy(true);
    setError("");
    try {
      onChange(await withTimeout(
        window.pulseTray.logout(),
        "O logout demorou para responder. Tente novamente."
      ));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveQuietHours(): Promise<void> {
    if (!dirty || validationError) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      onChange(await withTimeout(
        window.pulseTray.saveQuietHours(quietHours),
        "Os ajustes demoraram para responder. Tente novamente."
      ));
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
                  onChange={(event) => updateQuietHours(quietHours.map((item, itemIndex) =>
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
                  onChange={(event) => updateQuietHours(quietHours.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, end: event.target.value } : item
                  ))}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remover janela ${index + 1}`}
                onClick={() => updateQuietHours(quietHours.filter((_, itemIndex) => itemIndex !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="quiet-add"
          disabled={quietHours.length >= 12}
          onClick={() => updateQuietHours([...quietHours, { start: "22:00", end: "07:00" }])}
        >
          + Adicionar janela
        </button>
        {error && <ErrorNotice message={error} />}
        {validationError && <ErrorNotice message={validationError} />}
        {saved && <div className="notice success" role="status">Janelas de silêncio salvas.</div>}
        <button
          type="button"
          className="secondary"
          disabled={busy || !dirty || Boolean(validationError)}
          onClick={saveQuietHours}
        >
          {busy ? "Salvando…" : "Salvar janelas"}
        </button>
      </section>
      <button className="danger-link" disabled={busy} onClick={logout}>Fazer logout</button>
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
  return (
    <div className="panel-loading" role="status" aria-live="polite" aria-busy="true">
      <span aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
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
  const [feedbackRequesterId, setFeedbackRequesterId] = useState<string>();
  const [error, setError] = useState("");

  async function loadSession(): Promise<void> {
    setError("");
    try {
      setSession(await withTimeout(
        window.pulseTray.bootstrap(),
        "O iTransform Pulse demorou para abrir. Tente novamente."
      ));
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  useEffect(() => {
    void loadSession();
    return window.pulseTray.onNavigate((next, isRequired, context) => {
      if (surface === "question" && next !== "question") return;
      if (surface === "panel" && next === "question") return;
      void loadSession();
      setRequired(isRequired);
      setView(next);
      setFeedbackRequesterId(context?.feedbackRequesterId);
      setNavigationKey((current) => current + 1);
    });
  }, [surface]);

  if (error && !session) {
    return (
      <main className="fatal">
        <ErrorNotice message={error} />
        <button type="button" className="primary" onClick={() => void loadSession()}>
          Tentar novamente
        </button>
      </main>
    );
  }
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
            className={
              view === "feedbacks" ||
              view === "request-feedback" ||
              view === "received-feedback"
                ? "active"
                : ""
            }
            aria-current={
              view === "feedbacks" ||
              view === "request-feedback" ||
              view === "received-feedback"
                ? "page"
                : undefined
            }
            onClick={() => {
              setFeedbackRequesterId(undefined);
              setView("feedbacks");
            }}
            title="Feedbacks"
            aria-label="Feedbacks"
          >
            <span className="nav-icon"><FeedbackIcon /></span>
            <span className="nav-label">Feedbacks</span>
          </button>
          {session.profile?.isLeader && (
            <button
              className="external-navigation"
              onClick={() => void window.pulseTray.openManagerHub()}
              title="Abrir ManagerHub no navegador"
              aria-label="Abrir ManagerHub no navegador"
            >
              <span className="nav-icon">
                <ManagerIcon />
                <span className="external-link-badge" aria-hidden="true">↗</span>
              </span>
              <span className="nav-label">ManagerHub</span>
            </button>
          )}
          <button
            className={view === "settings" ? "active" : ""}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
            title="Ajustes"
            aria-label="Ajustes"
          >
            <span className="nav-icon"><SettingsIcon /></span>
            <span className="nav-label">Ajustes</span>
          </button>
        </nav>
        <div
          className="user-mini"
          title={session.profile?.name}
          role="img"
          aria-label={`Usuário: ${session.profile?.name}`}
        >
          {session.profile?.name.slice(0, 1).toUpperCase()}
        </div>
      </aside>
      <main className="content">
        {error && (
          <div className="inline-recovery">
            <ErrorNotice message={error} />
            <button type="button" className="secondary" onClick={() => void loadSession()}>
              Tentar novamente
            </button>
          </div>
        )}
        <div
          hidden={
            view !== "feedbacks" &&
            view !== "request-feedback" &&
            view !== "received-feedback"
          }
        >
          <FeedbackHub
            key={`${navigationKey}-${view}`}
            onChange={setSession}
            requestedTab={view === "received-feedback" ? "received" : "home"}
            requestedAction={
              feedbackRequesterId ? "send" : view === "request-feedback" ? "request" : undefined
            }
            requestedRecipientId={feedbackRequesterId}
          />
        </div>
        <div hidden={view !== "settings"}>
          <SettingsView session={session} onChange={setSession} />
        </div>
      </main>
    </div>
  );
}
