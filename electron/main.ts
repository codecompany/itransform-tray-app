import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  session,
  Tray
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActivityEvent,
  AppView,
  DailyQuestion,
  EmployeeProfile,
  FeedbackDimension,
  FeedbackDraft,
  SessionView
} from "../src/contracts.js";
import { DailyScheduler, localDate } from "./scheduler.js";
import { ApiError, SintoniaClient, type AccessTokenBundle } from "./sintonia.js";

interface LocalSession {
  tokenCipher?: string;
  tokensCipher?: string;
  profile?: EmployeeProfile;
  dailyTime?: string;
  lastAnswerDate?: string;
  lastAnswerQuestionId?: string;
  events: ActivityEvent[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new SintoniaClient();
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let questionRequired = false;
let currentQuestion: DailyQuestion | null = null;
let answerInFlight = false;
let feedbackInFlight = false;
let store: SessionStore;

class SessionStore {
  private state: LocalSession = { events: [] };
  private readonly file = path.join(app.getPath("userData"), "session.json");

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.state = JSON.parse(raw) as LocalSession;
      this.state.events ??= [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await this.clear();
      }
    }
  }

  snapshot(): LocalSession {
    return this.state;
  }

  token(): string {
    if (!this.state.tokenCipher) throw new Error("Vincule seu token antes de continuar.");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do sistema não está disponível.");
    }
    return safeStorage.decryptString(Buffer.from(this.state.tokenCipher, "base64"));
  }

  tokens(): AccessTokenBundle | undefined {
    if (!this.state.tokensCipher) return undefined;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do sistema não está disponível.");
    }
    const raw = safeStorage.decryptString(Buffer.from(this.state.tokensCipher, "base64"));
    return JSON.parse(raw) as AccessTokenBundle;
  }

  async link(token: string, tokens: AccessTokenBundle, profile: EmployeeProfile): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do sistema não está disponível.");
    }
    this.state = {
      tokenCipher: safeStorage.encryptString(token).toString("base64"),
      tokensCipher: safeStorage.encryptString(JSON.stringify(tokens)).toString("base64"),
      profile,
      events: []
    };
    this.event("system", "PulseTray vinculado", `Olá, ${profile.name}. Sua conta está pronta.`);
    await this.save();
  }

  async setTokens(tokens: AccessTokenBundle): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("O armazenamento seguro do sistema não está disponível.");
    }
    this.state.tokensCipher = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
    await this.save();
  }

  async setDailyTime(time: string): Promise<void> {
    this.state.dailyTime = time;
    this.event("system", "Horário diário atualizado", `A pergunta diária será exibida às ${time}.`);
    await this.save();
  }

  async markAnswered(date: string, questionId: string): Promise<void> {
    this.state.lastAnswerDate = date;
    this.state.lastAnswerQuestionId = questionId;
    this.event("system", "Pergunta diária respondida", `Resposta registrada em ${date}.`);
    await this.save();
  }

  async addEvent(kind: ActivityEvent["kind"], title: string, detail: string): Promise<void> {
    this.event(kind, title, detail);
    await this.save();
  }

  async clear(): Promise<void> {
    this.state = { events: [] };
    await fs.rm(this.file, { force: true });
  }

  private event(kind: ActivityEvent["kind"], title: string, detail: string): void {
    this.state.events.unshift({
      id: crypto.randomUUID(),
      kind,
      title,
      detail,
      at: new Date().toISOString()
    });
    this.state.events = this.state.events.slice(0, 200);
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, this.file);
  }
}

function sessionView(): SessionView {
  const state = store.snapshot();
  return {
    linked: Boolean(state.profile && state.tokenCipher),
    configured: Boolean(state.profile && state.tokenCipher && state.dailyTime),
    profile: state.profile,
    dailyTime: state.dailyTime,
    lastAnswerDate: state.lastAnswerDate,
    events: state.events,
    receivedFeedbackAvailable: false
  };
}

function requireProfile(): EmployeeProfile {
  const profile = store.snapshot().profile;
  if (!profile) throw new Error("Vincule seu token antes de continuar.");
  return profile;
}

function accessTokensFresh(tokens: AccessTokenBundle | undefined): tokens is AccessTokenBundle {
  if (!tokens) return false;
  const expiresAt = Date.parse(tokens.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

async function accessTokens(force = false): Promise<AccessTokenBundle> {
  const cached = store.tokens();
  if (!force && accessTokensFresh(cached)) return cached;
  try {
    const refreshed = await client.exchangeTrayToken(store.token());
    await store.setTokens(refreshed);
    return refreshed;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await logout();
      throw new Error("Seu token expirou ou foi substituído. Solicite um novo acesso.");
    }
    throw error;
  }
}

async function withAccessTokens<T>(
  operation: (tokens: AccessTokenBundle) => Promise<T>
): Promise<T> {
  let tokens = await accessTokens();
  try {
    return await operation(tokens);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    tokens = await accessTokens(true);
    return operation(tokens);
  }
}

function stringValue(value: unknown, field: string, max = 8_192): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${field} inválido.`);
  }
  return value.trim();
}

function setQuestionRequired(required: boolean): void {
  questionRequired = required;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setClosable(!required);
  mainWindow.setAlwaysOnTop(required, required ? "floating" : "normal");
  if (process.platform === "darwin") mainWindow.setVisibleOnAllWorkspaces(required);
}

function sendNavigation(view: AppView, required = false): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => mainWindow?.webContents.send("app:navigate", view, required);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
  else send();
}

function showWindow(view: AppView = "question", required = false): void {
  if (!mainWindow) return;
  if (required) setQuestionRequired(true);
  mainWindow.show();
  mainWindow.focus();
  sendNavigation(view, required || questionRequired);
}

async function checkDailyQuestion(): Promise<void> {
  if (questionRequired) {
    showWindow("question", true);
    return;
  }
  const profile = store.snapshot().profile;
  if (!profile) return;
  try {
    const result = await withAccessTokens((tokens) => client.getQuestion(tokens.pulseToken, profile.id));
    if (!result || store.snapshot().lastAnswerDate === result.date) return;
    currentQuestion = { ...result, answered: false };
    await store.addEvent("system", "Pergunta diária disponível", "A pergunta de hoje aguarda sua resposta.");
    if (Notification.isSupported()) {
      new Notification({ title: "PulseTray", body: "Sua pergunta diária está pronta." }).show();
    }
    showWindow("question", true);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) await logout();
  }
}

const scheduler = new DailyScheduler(
  () => ({
    time: store?.snapshot().dailyTime,
    lastAnswerDate: store?.snapshot().lastAnswerDate
  }),
  checkDailyQuestion
);

function iconPath(): string {
  return path.join(app.getAppPath(), "assets", "icon.png");
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 440,
    minHeight: 620,
    show: false,
    title: "PulseTray",
    icon: iconPath(),
    backgroundColor: "#f5f7f6",
    autoHideMenuBar: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (questionRequired) {
      window.show();
      window.focus();
    } else {
      window.hide();
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
  return window;
}

function createTray(): Tray {
  const image = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 });
  const appTray = new Tray(image);
  appTray.setToolTip("PulseTray");
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: "Questão diária", click: () => showWindow("question") },
    { label: "Enviar feedback", click: () => showWindow("feedback") },
    { label: "Feedbacks recebidos", click: () => showWindow("received") },
    { label: "Notificações", click: () => showWindow("notifications") },
    { type: "separator" },
    { label: "Configurações", click: () => showWindow("settings") },
    { type: "separator" },
    {
      label: "Encerrar PulseTray",
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
  appTray.on("click", () => showWindow("question"));
  return appTray;
}

async function logout(): Promise<SessionView> {
  scheduler.stop();
  currentQuestion = null;
  setQuestionRequired(false);
  await store.clear();
  return sessionView();
}

function trusted(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error("Origem IPC não autorizada.");
  }
}

function registerIpc(): void {
  ipcMain.handle("session:bootstrap", (event) => {
    trusted(event);
    return sessionView();
  });
  ipcMain.handle("session:request-access", async (event, rawEmail: unknown) => {
    trusted(event);
    const email = stringValue(rawEmail, "E-mail", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Informe um e-mail corporativo válido.");
    }
    return client.requestAccess(email);
  });
  ipcMain.handle("session:link", async (event, rawToken: unknown) => {
    trusted(event);
    const token = stringValue(rawToken, "Token");
    const tokens = await client.exchangeTrayToken(token);
    const profile = await client.link(tokens.employeeToken, tokens.employeeId);
    await store.link(token, tokens, profile);
    return sessionView();
  });
  ipcMain.handle("session:daily-time", async (event, rawTime: unknown) => {
    trusted(event);
    requireProfile();
    const time = stringValue(rawTime, "Horário", 5);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Horário inválido.");
    await store.setDailyTime(time);
    scheduler.start();
    return sessionView();
  });
  ipcMain.handle("session:logout", async (event) => {
    trusted(event);
    return logout();
  });
  ipcMain.handle("question:get", async (event) => {
    trusted(event);
    const profile = requireProfile();
    const question = await withAccessTokens((tokens) => client.getQuestion(tokens.pulseToken, profile.id));
    if (!question) {
      currentQuestion = null;
      return null;
    }
    currentQuestion = {
      ...question,
      answered: store.snapshot().lastAnswerDate === question.date
    };
    return currentQuestion;
  });
  ipcMain.handle("question:answer", async (event, raw: unknown) => {
    trusted(event);
    if (answerInFlight) throw new Error("Sua resposta já está sendo enviada.");
    const input = raw as Record<string, unknown>;
    const questionId = stringValue(input?.questionId, "Pergunta", 200);
    const value = stringValue(input?.value, "Resposta", 100);
    const date = stringValue(input?.date, "Data", 10);
    const profile = requireProfile();
    if (!currentQuestion || currentQuestion.question.id !== questionId || currentQuestion.date !== date) {
      throw new Error("A pergunta mudou. Recarregue antes de responder.");
    }
    if (!currentQuestion.question.choices.some((choice) => choice.value === value)) {
      throw new Error("Selecione uma alternativa válida.");
    }
    if (store.snapshot().lastAnswerDate === date) throw new Error("A pergunta de hoje já foi respondida.");
    answerInFlight = true;
    try {
      await withAccessTokens((tokens) =>
        client.submitAnswer(tokens.pulseToken, profile.id, questionId, value)
      );
      await store.markAnswered(date, questionId);
      currentQuestion = { ...currentQuestion, answered: true };
      setQuestionRequired(false);
      return sessionView();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        currentQuestion = null;
        setQuestionRequired(false);
        sendNavigation("question", false);
        throw new Error("A pergunta não está mais disponível.");
      }
      throw error;
    } finally {
      answerInFlight = false;
    }
  });
  ipcMain.handle("feedback:employees", async (event) => {
    trusted(event);
    const profile = requireProfile();
    return withAccessTokens((tokens) =>
      client.listEmployees(tokens.employeeToken, profile.companyId)
    );
  });
  ipcMain.handle("feedback:dimensions", async (event) => {
    trusted(event);
    const profile = requireProfile();
    return withAccessTokens((tokens) =>
      client.listFeedbackDimensions(tokens.knowledgeToken, profile.companyId)
    );
  });
  ipcMain.handle("feedback:send", async (event, raw: unknown) => {
    trusted(event);
    if (feedbackInFlight) throw new Error("Seu feedback já está sendo enviado.");
    const input = raw as Partial<FeedbackDraft>;
    const draft: FeedbackDraft = {
      toEmployeeId: stringValue(input.toEmployeeId, "Colaborador", 200),
      subDimensionId: stringValue(input.subDimensionId, "Subdimensão", 200),
      importance: Number(input.importance),
      message: stringValue(input.message, "Mensagem", 400)
    };
    if (!Number.isInteger(draft.importance) || draft.importance < 1 || draft.importance > 5) {
      throw new Error("A importância deve estar entre 1 e 5.");
    }
    const profile = requireProfile();
    if (draft.toEmployeeId === profile.id) throw new Error("Selecione outro colaborador.");
    feedbackInFlight = true;
    try {
      const tokens = await accessTokens();
      const [employees, dimensions] = await Promise.all([
        client.listEmployees(tokens.employeeToken, profile.companyId),
        client.listFeedbackDimensions(tokens.knowledgeToken, profile.companyId)
      ]);
      const recipient = employees.find((employee) => employee.id === draft.toEmployeeId);
      const dimension = dimensions.find((item) => item.id === draft.subDimensionId) as FeedbackDimension | undefined;
      if (!recipient || !dimension) throw new Error("Colaborador ou subdimensão inválida.");
      await withAccessTokens((freshTokens) =>
        client.sendFeedback(freshTokens.pulseToken, profile, draft, dimension)
      );
      await store.addEvent(
        "feedback-sent",
        `Feedback enviado para ${recipient.name}`,
        `${dimension.indexKey} · ${dimension.name} · importância ${draft.importance}`
      );
    } finally {
      feedbackInFlight = false;
    }
  });
  ipcMain.handle("feedback:received", (event) => {
    trusted(event);
    return {
      available: false,
      feedbacks: [],
      message: "O serviço Sintonia ainda não expõe uma rota autorizada para feedbacks recebidos."
    };
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow("question", questionRequired));
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    quitting = true;
    scheduler.stop();
  });
  void app.whenReady().then(async () => {
    app.setAppUserModelId("com.codecompany.sintonia.pulsetray");
    if (!process.argv.includes("--test-mode")) {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        args: ["--hidden"]
      });
    }
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
          ]
        }
      });
    });
    store = new SessionStore();
    await store.load();
    mainWindow = createWindow();
    tray = createTray();
    registerIpc();
    powerMonitor.on("resume", () => void scheduler.check());
    if (store.snapshot().dailyTime) scheduler.start();
    if (!process.argv.includes("--hidden") || !store.snapshot().profile) {
      mainWindow.once("ready-to-show", () => showWindow("question"));
    }
  });
}
