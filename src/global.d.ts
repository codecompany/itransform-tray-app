import type { PulseTrayApi } from "./contracts";

declare global {
  interface Window {
    pulseTray: PulseTrayApi;
  }
}

export {};
