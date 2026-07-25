const { tsImport } = require("tsx/esm/api");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

tsImport("../electron/main.ts", {
  parentURL: pathToFileURL(__filename).href,
  tsconfig: path.join(__dirname, "..", "electron", "tsconfig.json")
}).catch((error) => {
  console.error("Failed to load iTransform Pulse main process", error);
  process.exit(1);
});
