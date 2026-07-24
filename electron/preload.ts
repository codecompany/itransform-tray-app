import { contextBridge, ipcRenderer } from "electron";
import type { AppView, FeedbackDraft, PulseTrayApi } from "../src/contracts.js";

const api: PulseTrayApi = {
  bootstrap: () => ipcRenderer.invoke("session:bootstrap"),
  requestAccess: (email) => ipcRenderer.invoke("session:request-access", email),
  link: (token) => ipcRenderer.invoke("session:link", token),
  getQuestion: () => ipcRenderer.invoke("question:get"),
  submitAnswer: (input) => ipcRenderer.invoke("question:answer", input),
  skipQuestion: () => ipcRenderer.invoke("question:skip"),
  listEmployees: () => ipcRenderer.invoke("feedback:employees"),
  listFeedbackTaxonomy: () => ipcRenderer.invoke("feedback:taxonomy"),
  sendFeedback: (draft: FeedbackDraft) => ipcRenderer.invoke("feedback:send", draft),
  listReceivedFeedback: () => ipcRenderer.invoke("feedback:received"),
  logout: () => ipcRenderer.invoke("session:logout"),
  onNavigate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, view: AppView, required: boolean) =>
      callback(view, required);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  }
};

contextBridge.exposeInMainWorld("pulseTray", api);
