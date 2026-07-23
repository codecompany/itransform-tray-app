const { register } = require("node:module");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

process.env.TS_NODE_PROJECT = path.join(__dirname, "..", "electron", "tsconfig.json");
process.env.TS_NODE_TRANSPILE_ONLY = "true";
register("tsx/esm", pathToFileURL(__filename));

import("../electron/main.ts").catch((error) => {
  console.error("Failed to load PulseTray main process", error);
  process.exit(1);
});
