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
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppView,
  EmployeeProfile,
  FeedbackDraft,
  SessionView
} from "../src/contracts.js";
import {
  APPLICATION_ID,
  LEGACY_USER_DATA_DIRECTORY,
  PRODUCT_NAME
} from "../src/product.js";
import { DailyScheduler } from "./scheduler.js";
import {
  ApiError,
  PulseApiClient,
  type AccessTokenBundle,
  validateFeedbackSelection
} from "./pulse-api.js";
import {
  notificationFor,
  type NativeNotificationKind
} from "./notifications.js";
import { DailyQuestionCoordinator } from "./daily-question-coordinator.js";
import { shouldPromptAutomatically } from "./question-state.js";
import { SessionStore } from "./session-store.js";
import { createTrayMenuTemplate } from "./tray-menu.js";
import { applyQuestionWindowMode } from "./window-mode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new PulseApiClient();
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let questionRequired = false;
let answerInFlight = false;
let feedbackInFlight = false;
let store: SessionStore;
let dailyQuestions: DailyQuestionCoordinator;

function sessionView(): SessionView {
  const state = store.snapshot();
  const daily = store.daily();
  return {
    linked: Boolean(state.profile && state.tokenCipher),
    configured: Boolean(state.profile && state.tokenCipher),
    profile: state.profile,
    lastAnswerDate: daily.lastAnswerDate,
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
  applyQuestionWindowMode(mainWindow, required);
}

function sendNavigation(view: AppView, required = false): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => mainWindow?.webContents.send("app:navigate", view, required);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
  else send();
}

function showWindow(view: AppView = "feedback", required = false): void {
  if (!mainWindow) return;
  if (required) setQuestionRequired(true);
  const targetView = required || questionRequired ? "question" : view;
  mainWindow.show();
  mainWindow.focus();
  sendNavigation(targetView, required || questionRequired);
}

function showNativeNotification(kind: NativeNotificationKind): void {
  if (!Notification.isSupported()) return;
  const policy = notificationFor(kind);
  const notification = new Notification({ title: PRODUCT_NAME, body: policy.body });
  notification.on("click", () => showWindow(policy.view, policy.required));
  notification.show();
}

function releaseQuestionWindow(): void {
  if (!questionRequired) return;
  setQuestionRequired(false);
  sendNavigation("question", false);
}

const launchedHidden = process.argv.includes("--hidden");
const scheduler = new DailyScheduler((now) =>
  dailyQuestions.run(now, shouldPromptAutomatically(launchedHidden, now))
);
app.setPath("userData", path.join(app.getPath("appData"), LEGACY_USER_DATA_DIRECTORY));

function applicationIconPath(): string {
  return path.join(app.getAppPath(), "assets", "icon.png");
}

function trayIcon(): Electron.NativeImage {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromPath(
      path.join(app.getAppPath(), "assets", "trayTemplate.png")
    );
    image.setTemplateImage(true);
    return image;
  }
  return nativeImage.createFromPath(applicationIconPath()).resize({ width: 20, height: 20 });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 440,
    minHeight: 620,
    show: false,
    title: PRODUCT_NAME,
    icon: applicationIconPath(),
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
  window.on("minimize", () => {
    if (!questionRequired) return;
    window.restore();
    window.focus();
  });
  window.on("leave-full-screen", () => {
    if (questionRequired) window.setFullScreen(true);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(app.getAppPath(), "dist", "renderer", "index.html"));
  return window;
}

function createTray(): Tray {
  const appTray = new Tray(trayIcon());
  appTray.setToolTip(PRODUCT_NAME);
  appTray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    openDailyQuestion: () => showWindow("question"),
    openFeedbackComposer: () => showWindow("feedback"),
    openReceivedFeedback: () => showWindow("received"),
    openSettings: () => showWindow("settings"),
    quit: () => {
        quitting = true;
        app.quit();
      }
  })));
  return appTray;
}

async function logout(): Promise<SessionView> {
  scheduler.stop();
  dailyQuestions?.clear();
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
    scheduler.start(false);
    setImmediate(() => void dailyQuestions.run(new Date(), true));
    showNativeNotification("linked");
    return sessionView();
  });
  ipcMain.handle("session:logout", async (event) => {
    trusted(event);
    return logout();
  });
  ipcMain.handle("question:get", async (event) => {
    trusted(event);
    requireProfile();
    const cached = dailyQuestions.current();
    await dailyQuestions.check(new Date(), false);
    return dailyQuestions.current() ?? cached;
  });
  ipcMain.handle("question:answer", async (event, raw: unknown) => {
    trusted(event);
    if (answerInFlight) throw new Error("Sua resposta já está sendo enviada.");
    const input = raw as Record<string, unknown>;
    const questionId = stringValue(input?.questionId, "Pergunta", 200);
    const value = stringValue(input?.value, "Resposta", 100);
    const date = stringValue(input?.date, "Data", 10);
    requireProfile();
    answerInFlight = true;
    try {
      await dailyQuestions.answer({ questionId, value, date });
      setImmediate(() => void dailyQuestions.run(new Date(), false));
      return sessionView();
    } finally {
      answerInFlight = false;
    }
  });
  ipcMain.handle("question:skip", async (event) => {
    trusted(event);
    requireProfile();
    await dailyQuestions.skip();
    sendNavigation("feedback", false);
    setImmediate(() => mainWindow?.hide());
    return sessionView();
  });
  ipcMain.handle("feedback:employees", async (event) => {
    trusted(event);
    const profile = requireProfile();
    const employees = await withAccessTokens((tokens) =>
      client.listEmployees(tokens.employeeToken, profile.companyId)
    );
    return employees.filter((employee) => employee.id !== profile.id);
  });
  ipcMain.handle("feedback:taxonomy", async (event) => {
    trusted(event);
    const profile = requireProfile();
    return withAccessTokens((tokens) =>
      client.listFeedbackTaxonomy(tokens.knowledgeToken, profile.companyId)
    );
  });
  ipcMain.handle("feedback:send", async (event, raw: unknown) => {
    trusted(event);
    if (feedbackInFlight) throw new Error("Seu feedback já está sendo enviado.");
    const input = raw as Partial<FeedbackDraft>;
    const draft: FeedbackDraft = {
      toEmployeeId: stringValue(input.toEmployeeId, "Colaborador", 200),
      indexId: stringValue(input.indexId, "Índice", 200),
      dimensionId: stringValue(input.dimensionId, "Dimensão", 200),
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
      const [employees, taxonomy] = await Promise.all([
        client.listEmployees(tokens.employeeToken, profile.companyId),
        client.listFeedbackTaxonomy(tokens.knowledgeToken, profile.companyId)
      ]);
      const recipient = employees.find((employee) => employee.id === draft.toEmployeeId);
      if (!recipient) {
        throw new Error("O colaborador selecionado não está mais disponível. Atualize a lista.");
      }
      const selection = validateFeedbackSelection(draft, taxonomy);
      await withAccessTokens((freshTokens) =>
        client.sendFeedback(freshTokens, profile, draft)
      );
      await store.addEvent(
        "feedback-sent",
        `Feedback enviado para ${recipient.name}`,
        `${selection.index.key} · ${selection.dimension.name} · ` +
        `${selection.subDimension.name} · importância ${draft.importance}`
      );
      showNativeNotification("feedback-sent");
    } finally {
      feedbackInFlight = false;
    }
  });
  ipcMain.handle("feedback:received", (event) => {
    trusted(event);
    return {
      available: false,
      feedbacks: [],
      message: "O serviço iTransform ainda não expõe uma rota autorizada para feedbacks recebidos."
    };
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow(questionRequired ? "question" : "feedback", questionRequired));
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    quitting = true;
    scheduler.stop();
  });
  void app.whenReady().then(async () => {
    app.setAppUserModelId(APPLICATION_ID);
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
    store = new SessionStore(
      path.join(app.getPath("userData"), "session.json"),
      safeStorage
    );
    await store.load();
    dailyQuestions = new DailyQuestionCoordinator(
      store,
      {
        getQuestion: () => {
          const profile = requireProfile();
          return withAccessTokens((tokens) =>
            client.getQuestion(tokens.pulseToken, profile.id)
          );
        },
        submitAnswer: (answer) => {
          const profile = requireProfile();
          return withAccessTokens((tokens) =>
            client.submitAnswer(
              tokens.pulseToken,
              profile.id,
              answer.questionId,
              answer.value
            )
          );
        }
      },
      {
        prompt: () => {
          showNativeNotification("daily-question");
          showWindow("question", true);
        },
        release: releaseQuestionWindow
      }
    );
    mainWindow = createWindow();
    tray = createTray();
    registerIpc();
    powerMonitor.on("resume", () => void dailyQuestions.run(new Date(), true));
    if (store.snapshot().profile) scheduler.start();
    if (!launchedHidden || !store.snapshot().profile) {
      mainWindow.once("ready-to-show", () => showWindow("feedback"));
    }
  });
}
