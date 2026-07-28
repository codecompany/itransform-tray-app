import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/montserrat/latin-800.css";
import App from "./App";
import { installPreviewBridge } from "./preview";
import "./styles.css";

if (
  (import.meta.env.DEV || import.meta.env.VITE_VISUAL_SMOKE === "true")
  && !window.pulseTray
) {
  installPreviewBridge();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (import.meta.env.VITE_VISUAL_SMOKE === "true") {
  window.setTimeout(() => {
    void (async () => {
      const { prepareVisualJourney } = await import("./visual-smoke");
      const journey = new URLSearchParams(location.search).get("journey") ?? "";
      let journeyError = "";
      try {
        await prepareVisualJourney(journey);
      } catch (error) {
        journeyError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const controls = [...document.querySelectorAll<HTMLElement>("button, input, textarea")];
      const feedbackNavigation = document.querySelector<HTMLElement>(
        'button[aria-label="Feedbacks"]'
      )?.getBoundingClientRect();
      const settingsNavigation = document.querySelector<HTMLElement>(
        'button[aria-label="Ajustes"]'
      )?.getBoundingClientRect();
      const result = {
        innerWidth,
        innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        journeyError,
        navigationGap: feedbackNavigation && settingsNavigation
          ? Math.round(settingsNavigation.top - feedbackNavigation.bottom)
          : undefined,
        smallControls: controls
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
          })
          .map((element) => ({
            label: element.getAttribute("aria-label")
              || element.textContent?.trim()
              || element.id,
            width: Math.round(element.getBoundingClientRect().width),
            height: Math.round(element.getBoundingClientRect().height)
          }))
      };
      const output = document.createElement("script");
      output.id = "visual-smoke-result";
      output.type = "application/json";
      output.textContent = JSON.stringify(result);
      document.body.append(output);
      if (window.parent !== window) {
        window.parent.postMessage({ kind: "visual-smoke-result", result }, location.origin);
      }
    })();
  }, 800);
}
