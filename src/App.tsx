import { useEffect, useMemo, useState } from "react";
import logo from "./assets/logo-iTransform.png";
import type {
  AppView,
  DailyQuestion,
  EmployeeOption,
  FeedbackDimension,
  FeedbackDraft,
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

function ScheduleScreen({
  session,
  onSaved
}: {
  session: SessionView;
  onSaved: (session: SessionView) => void;
}): JSX.Element {
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(await window.pulseTray.saveDailyTime(time));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="welcome">
      <section className="welcome-card">
        <img src={logo} className="brand-logo" alt="iTransform" />
        <span className="eyebrow">Bem-vindo, {session.profile?.name}</span>
        <h1>Quando devemos perguntar?</h1>
        <p>Escolha o horário em que a pergunta diária deve aparecer automaticamente.</p>
        <form onSubmit={submit} className="stack">
          <label htmlFor="daily-time">Horário preferido</label>
          <input
            id="daily-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
          {error && <ErrorNotice message={error} />}
          <button className="primary" disabled={busy}>{busy ? "Salvando…" : "Começar"}</button>
        </form>
      </section>
    </main>
  );
}

function QuestionView({
  required,
  onAnswered,
  openFeedback
}: {
  required: boolean;
  onAnswered: (session: SessionView) => void;
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
      setQuestion({ ...question, answered: true });
      onAnswered(session);
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
    return (
      <Page title="Questão diária">
        <div className="success-card">
          <span className="success-mark">✓</span>
          <span className="eyebrow">Resposta registrada</span>
          <h2>Obrigado por compartilhar seu pulso de hoje.</h2>
          <p>Você concluiu a pergunta diária. Que tal reconhecer alguém agora?</p>
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
        <button className="primary" disabled={!selected || busy} onClick={answer}>
          {busy ? "Enviando…" : "Enviar resposta"}
        </button>
        {required && <small>Esta janela será liberada após o envio da resposta.</small>}
      </div>
    </Page>
  );
}

function FeedbackView(): JSX.Element {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [dimensions, setDimensions] = useState<FeedbackDimension[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<FeedbackDraft>({
    toEmployeeId: "",
    subDimensionId: "",
    importance: 3,
    message: ""
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void Promise.all([window.pulseTray.listEmployees(), window.pulseTray.listFeedbackDimensions()])
      .then(([people, items]) => {
        setEmployees(people);
        setDimensions(items);
      })
      .catch((reason) => setError(messageOf(reason)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return [];
    return employees
      .filter((employee) =>
        `${employee.name} ${employee.email} ${employee.position}`.toLocaleLowerCase("pt-BR").includes(normalized)
      )
      .slice(0, 6);
  }, [employees, query]);
  const selectedEmployee = employees.find((employee) => employee.id === draft.toEmployeeId);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await window.pulseTray.sendFeedback(draft);
      setSent(true);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PanelLoading label="Preparando o formulário…" />;
  if (sent) {
    return (
      <Page title="Enviar feedback">
        <div className="success-card">
          <span className="success-mark">✓</span>
          <h2>Seu feedback foi enviado com sucesso!</h2>
          <p>O Sintonia cuidará da entrega e do impacto analítico.</p>
          <button
            className="secondary"
            onClick={() => {
              setDraft({ toEmployeeId: "", subDimensionId: "", importance: 3, message: "" });
              setQuery("");
              setSent(false);
            }}
          >
            Enviar outro feedback
          </button>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Enviar feedback para alguém">
      <form className="feedback-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="employee-search">Colaborador</label>
          <input
            id="employee-search"
            value={selectedEmployee ? selectedEmployee.name : query}
            onChange={(event) => {
              setQuery(event.target.value);
              setDraft({ ...draft, toEmployeeId: "" });
            }}
            placeholder="Busque por nome, e-mail ou cargo"
            autoComplete="off"
          />
          {!selectedEmployee && filtered.length > 0 && (
            <div className="search-results">
              {filtered.map((employee) => (
                <button
                  type="button"
                  key={employee.id}
                  onClick={() => {
                    setDraft({ ...draft, toEmployeeId: employee.id });
                    setQuery(employee.name);
                  }}
                >
                  <strong>{employee.name}</strong>
                  <span>{employee.position} · {employee.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
        {error && <ErrorNotice message={error} />}
        <button
          className="primary"
          disabled={busy || !draft.toEmployeeId || !draft.subDimensionId || !draft.message.trim()}
        >
          {busy ? "Enviando…" : "Enviar feedback"}
        </button>
      </form>
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

function NotificationsView({ session }: { session: SessionView }): JSX.Element {
  return (
    <Page title="Notificações">
      {session.events.length === 0 ? (
        <Empty icon="•" title="Sem notificações" text="Os eventos importantes do PulseTray aparecerão aqui." />
      ) : session.events.map((event) => (
        <article className="event-row" key={event.id}>
          <span className={`event-dot ${event.kind}`} />
          <div>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
            <time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.at))}</time>
          </div>
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
  const [time, setTime] = useState(session.dailyTime ?? "09:00");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const profile = session.profile!;

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      onChange(await window.pulseTray.saveDailyTime(time));
      setMessage("Horário atualizado.");
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

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
      <form className="settings-form" onSubmit={save}>
        <label htmlFor="settings-time">Horário da pergunta diária</label>
        <div>
          <input id="settings-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          <button className="secondary">Salvar</button>
        </div>
        {message && <div className="notice success">{message}</div>}
        {error && <ErrorNotice message={error} />}
      </form>
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
  { view: "question", symbol: "?", label: "Questão" },
  { view: "feedback", symbol: "+", label: "Feedback" },
  { view: "received", symbol: "↙", label: "Recebidos" },
  { view: "notifications", symbol: "•", label: "Avisos" },
  { view: "settings", symbol: "⚙", label: "Ajustes" }
];

export default function App(): JSX.Element {
  const [session, setSession] = useState<SessionView>();
  const [view, setView] = useState<AppView>("question");
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
  if (!session.configured) return <ScheduleScreen session={session} onSaved={setSession} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <img src={logo} alt="iTransform" />
        <nav aria-label="Navegação principal">
          {navigation.map((item) => (
            <button
              key={item.view}
              className={view === item.view ? "active" : ""}
              onClick={() => !required && setView(item.view)}
              disabled={required && item.view !== "question"}
              title={required && item.view !== "question" ? "Responda à pergunta diária para continuar" : item.label}
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
        {view === "question" && (
          <QuestionView
            required={required}
            onAnswered={(next) => {
              setSession(next);
              setRequired(false);
            }}
            openFeedback={() => setView("feedback")}
          />
        )}
        {view === "feedback" && <FeedbackView />}
        {view === "received" && <ReceivedView />}
        {view === "notifications" && <NotificationsView session={session} />}
        {view === "settings" && <SettingsView session={session} onChange={setSession} />}
      </main>
    </div>
  );
}
