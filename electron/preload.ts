import { contextBridge, ipcRenderer } from "electron";
import type {
  AppNavigationContext,
  AppView,
  FeedbackDraft,
  PulseTrayApi,
  QuietHoursWindow
} from "../src/contracts.js";

const api: PulseTrayApi = {
  bootstrap: () => ipcRenderer.invoke("session:bootstrap"),
  requestAccess: (email) => ipcRenderer.invoke("session:request-access", email),
  link: (token) => ipcRenderer.invoke("session:link", token),
  getQuestion: () => ipcRenderer.invoke("question:get"),
  submitAnswer: (input) => ipcRenderer.invoke("question:answer", input),
  skipQuestion: () => ipcRenderer.invoke("question:skip"),
  deferQuestion: () => ipcRenderer.invoke("question:defer"),
  listEmployees: () => ipcRenderer.invoke("feedback:employees"),
  sendFeedback: (draft: FeedbackDraft, requestId: string) =>
    ipcRenderer.invoke("feedback:send", draft, requestId),
  requestFeedback: (toEmployeeId: string, requestId: string) =>
    ipcRenderer.invoke("feedback:request", toEmployeeId, requestId),
  listFeedbackHistory: (direction) => ipcRenderer.invoke("feedback:history", direction),
  saveQuietHours: (windows: QuietHoursWindow[]) =>
    ipcRenderer.invoke("settings:quiet-hours", windows),
  openManagerHub: () => ipcRenderer.invoke("navigation:manager-hub"),
  openFeedbacks: () => ipcRenderer.invoke("navigation:feedbacks"),
  dismissQuestion: () => ipcRenderer.invoke("question:dismiss"),
  setRestartBlocker: (name, blocked) =>
    ipcRenderer.send("app:restart-blocker", name, blocked),
  logout: () => ipcRenderer.invoke("session:logout"),
  onNavigate: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      view: AppView,
      required: boolean,
      context?: AppNavigationContext
    ) => callback(view, required, context);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  }
};

contextBridge.exposeInMainWorld("pulseTray", api);
