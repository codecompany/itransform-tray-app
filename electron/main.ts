import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  Tray
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppView,
  EmployeeProfile,
  FeedbackDraft,
  QuietHoursWindow,
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
  type AccessTokenBundle
} from "./pulse-api.js";
import {
  notificationFor,
  type NativeNotificationKind
} from "./notifications.js";
import { DailyQuestionCoordinator } from "./daily-question-coordinator.js";
import { shouldPromptAutomatically } from "./question-state.js";
import { SessionStore } from "./session-store.js";
import { createTrayMenuTemplate } from "./tray-menu.js";
import { quietUntil, validateQuietHours } from "./quiet-hours.js";
import { applyQuestionWindowMode } from "./window-mode.js";
import { validateFeedbackDraft } from "./feedback-validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new PulseApiClient();
let panelWindow: BrowserWindow | undefined;
let questionWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let questionRequired = false;
let answerInFlight = false;
let feedbackInFlight = false;
let leadershipRefresh: Promise<void> | undefined;
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
    receivedFeedbackAvailable: true,
    quietHours: [...store.quietHours()]
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
  if (!questionWindow || questionWindow.isDestroyed()) return;
  applyQuestionWindowMode(questionWindow, required);
}

function sendNavigation(
  window: BrowserWindow | undefined,
  view: AppView,
  required = false
): void {
  if (!window || window.isDestroyed()) return;
  const send = () => window.webContents.send("app:navigate", view, required);
  if (window.webContents.isLoading()) window.webContents.once("did-finish-load", send);
  else send();
}

function rendererUrl(surface: "panel" | "question"): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    url.searchParams.set("surface", surface);
    return url.toString();
  }
  return "";
}

function loadRenderer(window: BrowserWindow, surface: "panel" | "question"): void {
  const devUrl = rendererUrl(surface);
  if (devUrl) {
    void window.loadURL(devUrl);
    return;
  }
  void window.loadFile(
    path.join(app.getAppPath(), "dist", "renderer", "index.html"),
    { query: { surface } }
  );
}

function showPanelWindow(view: Exclude<AppView, "question"> = "feedbacks"): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const workArea = screen.getDisplayMatching(panelWindow.getBounds()).workAreaSize;
  const preferred = view === "feedbacks"
    ? { width: 760, height: 820 }
    : { width: 520, height: 720 };
  panelWindow.setSize(
    Math.min(preferred.width, workArea.width - 32),
    Math.min(preferred.height, workArea.height - 32),
    true
  );
  panelWindow.center();
  panelWindow.show();
  panelWindow.focus();
  sendNavigation(panelWindow, view);
}

function showQuestionWindow(required = false): void {
  if (!questionWindow || questionWindow.isDestroyed()) {
    questionWindow = createQuestionWindow();
  }
  const enforced = required || questionRequired;
  setQuestionRequired(enforced);
  questionWindow.center();
  questionWindow.show();
  questionWindow.focus();
  sendNavigation(questionWindow, "question", enforced);
}

function showNativeNotification(kind: NativeNotificationKind): void {
  if (!Notification.isSupported()) return;
  const policy = notificationFor(kind);
  const notification = new Notification({ title: PRODUCT_NAME, body: policy.body });
  notification.on("click", () => {
    if (policy.view === "question") showQuestionWindow(policy.required);
    else showPanelWindow(policy.view);
  });
  notification.show();
}

function releaseQuestionWindow(): void {
  setQuestionRequired(false);
  sendNavigation(questionWindow, "question", false);
}

const launchedHidden = process.argv.includes("--hidden");
const scheduler = new DailyScheduler(async (now) => {
  const quietEnd = quietUntil([...store.quietHours()], now);
  await dailyQuestions.run(
    now,
    shouldPromptAutomatically(launchedHidden, now) && !quietEnd,
    quietEnd
  );
});
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

function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true
  };
}

function createPanelWindow(): BrowserWindow {
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
    webPreferences: secureWebPreferences()
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  loadRenderer(window, "panel");
  return window;
}

function createQuestionWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 660,
    height: 720,
    show: false,
    title: "Questão diária",
    icon: applicationIconPath(),
    frame: false,
    backgroundColor: "#f5f7f6",
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    webPreferences: secureWebPreferences()
  });
  applyQuestionWindowMode(window, false);
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (questionRequired) {
      window.show();
      window.focus();
      return;
    }
    window.hide();
  });
  window.on("minimize", () => {
    window.restore();
    window.focus();
  });
  loadRenderer(window, "question");
  return window;
}

function createTray(): Tray {
  const appTray = new Tray(trayIcon());
  appTray.setToolTip(PRODUCT_NAME);
  appTray.setContextMenu(Menu.buildFromTemplate(createTrayMenuTemplate({
    openDailyQuestion: () => showQuestionWindow(false),
    openFeedbacks: () => showPanelWindow("feedbacks"),
    openSettings: () => showPanelWindow("settings"),
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
  questionWindow?.hide();
  await store.clear();
  return sessionView();
}

function trusted(event: Electron.IpcMainInvokeEvent): void {
  const trustedIds = [panelWindow, questionWindow]
    .filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()))
    .map((window) => window.webContents.id);
  if (!trustedIds.includes(event.sender.id)) {
    throw new Error("Origem IPC não autorizada.");
  }
}

async function refreshLeadership(): Promise<void> {
  const snapshot = store.snapshot();
  const profile = snapshot.profile;
  const tokenCipher = snapshot.tokenCipher;
  if (!profile || profile.isLeader !== undefined) return;
  leadershipRefresh ??= (async () => {
    try {
      const isLeader = await withAccessTokens((tokens) =>
        client.hasDirectReports(tokens.employeeToken, profile.companyId, profile.id)
      );
      const current = store.snapshot();
      if (current.profile?.id !== profile.id || current.tokenCipher !== tokenCipher) return;
      await store.setProfile({ ...profile, isLeader });
    } catch (error) {
      console.warn(JSON.stringify({
        event: "leadership_check_failed",
        status: error instanceof ApiError ? error.status : undefined
      }));
    } finally {
      leadershipRefresh = undefined;
    }
  })();
  await leadershipRefresh;
}

function registerIpc(): void {
  ipcMain.handle("session:bootstrap", async (event) => {
    trusted(event);
    await refreshLeadership();
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
    const linkedProfile = await client.link(tokens.employeeToken, tokens.employeeId);
    const isLeader = await client.hasDirectReports(
      tokens.employeeToken,
      linkedProfile.companyId,
      linkedProfile.id
    ).catch(() => undefined);
    const profile = { ...linkedProfile, isLeader };
    await store.link(token, tokens, profile);
    scheduler.start(false);
    setImmediate(() => {
      const now = new Date();
      const quietEnd = quietUntil([...store.quietHours()], now);
      void dailyQuestions.run(now, !quietEnd, quietEnd);
    });
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
    setImmediate(() => questionWindow?.hide());
    return sessionView();
  });
  ipcMain.handle("question:dismiss", (event) => {
    trusted(event);
    if (questionRequired) {
      throw new Error("Responda ou pule a pergunta antes de fechar.");
    }
    questionWindow?.hide();
  });
  ipcMain.handle("feedback:employees", async (event) => {
    trusted(event);
    const profile = requireProfile();
    const employees = await withAccessTokens((tokens) =>
      client.listEmployees(tokens.employeeToken, profile.companyId)
    );
    return employees.filter((employee) => employee.id !== profile.id);
  });
  ipcMain.handle("feedback:send", async (event, raw: unknown) => {
    trusted(event);
    if (feedbackInFlight) throw new Error("Seu feedback já está sendo enviado.");
    const draft: FeedbackDraft = validateFeedbackDraft(raw);
    const profile = requireProfile();
    if (draft.toEmployeeId === profile.id) throw new Error("Selecione outro colaborador.");
    feedbackInFlight = true;
    try {
      const tokens = await accessTokens();
      const employees = await client.listEmployees(tokens.employeeToken, profile.companyId);
      const recipient = employees.find((employee) => employee.id === draft.toEmployeeId);
      if (!recipient) {
        throw new Error("O colaborador selecionado não está mais disponível. Atualize a lista.");
      }
      await withAccessTokens((freshTokens) =>
        client.sendFeedback(freshTokens, profile, draft)
      );
      await store.addEvent(
        "feedback-sent",
        `Feedback enviado para ${recipient.name}`,
        `${draft.method === "situational" ? "Situacional" : "Desenvolvimento"} · ` +
        `importância ${draft.importance}`
      );
      showNativeNotification("feedback-sent");
      return sessionView();
    } finally {
      feedbackInFlight = false;
    }
  });
  ipcMain.handle("feedback:history", async (event, rawDirection: unknown) => {
    trusted(event);
    const direction = rawDirection === "sent" || rawDirection === "received"
      ? rawDirection
      : undefined;
    if (!direction) throw new Error("Histórico de feedback inválido.");
    const profile = requireProfile();
    return withAccessTokens((tokens) =>
      client.listFeedbackHistory(tokens, profile, direction)
    );
  });
  ipcMain.handle("settings:quiet-hours", async (event, raw: unknown) => {
    trusted(event);
    requireProfile();
    const windows = validateQuietHours(raw) as QuietHoursWindow[];
    await store.setQuietHours(windows);
    const now = new Date();
    const quietEnd = quietUntil(windows, now);
    const daily = { ...store.daily() };
    daily.nextPromptAt = quietEnd?.toISOString() ?? now.toISOString();
    daily.nextCheckAt = daily.nextPromptAt;
    await store.setDaily(daily);
    setImmediate(() => void scheduler.check(new Date()));
    return sessionView();
  });
  ipcMain.handle("navigation:manager-hub", async (event) => {
    trusted(event);
    if (!requireProfile().isLeader) {
      throw new Error("O ManagerHub está disponível apenas para líderes.");
    }
    await shell.openExternal("https://itransform.cc");
  });
  ipcMain.handle("navigation:feedbacks", (event) => {
    trusted(event);
    if (questionRequired) {
      throw new Error("Responda ou pule a pergunta antes de abrir os feedbacks.");
    }
    questionWindow?.hide();
    showPanelWindow("feedbacks");
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (questionRequired) showQuestionWindow(true);
    else showPanelWindow();
  });
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
          showQuestionWindow(true);
        },
        release: releaseQuestionWindow
      }
    );
    tray = createTray();
    panelWindow = createPanelWindow();
    registerIpc();
    powerMonitor.on("resume", () => void scheduler.check(new Date()));
    if (store.snapshot().profile) scheduler.start();
    if (!launchedHidden || !store.snapshot().profile) {
      panelWindow.once("ready-to-show", () => showPanelWindow("feedbacks"));
    }
  });
}
