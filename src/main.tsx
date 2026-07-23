import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installPreviewBridge } from "./preview";
import "./styles.css";

if (import.meta.env.DEV && !window.pulseTray) installPreviewBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
