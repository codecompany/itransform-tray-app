import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { host: true, port: 4185, strictPort: true },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: path.resolve(__dirname, "src/test/setup.ts"),
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/App.tsx",
        "src/FeedbackView.tsx",
        "electron/answer-sync.ts",
        "electron/daily-question-coordinator.ts",
        "electron/notifications.ts",
        "electron/question-state.ts",
        "electron/scheduler.ts",
        "electron/session-store.ts",
        "electron/sintonia.ts",
        "electron/window-mode.ts"
      ],
      exclude: ["src/main.tsx", "src/global.d.ts", "src/preview.ts"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90
      }
    }
  }
});
