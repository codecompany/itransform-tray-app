#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const pkg = require("../package.json");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`iTransform Pulse ${pkg.version}

Uso:
  pulsetray             Inicia o aplicativo
  pulsetray --help      Mostra esta ajuda
  pulsetray --version   Mostra a versão`);
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`iTransform Pulse ${pkg.version}`);
  process.exit(0);
}

const executable = process.platform === "darwin"
  ? path.join(__dirname, "..", "native", "iTransform Pulse.app", "Contents", "MacOS", "iTransform Pulse")
  : path.join(__dirname, "..", "native", "iTransform Pulse.exe");

if (process.platform !== "darwin" && process.platform !== "win32") {
  console.error(`pulsetray: sistema não suportado: ${process.platform}`);
  process.exit(1);
}
if (!fs.existsSync(executable)) {
  console.error("pulsetray: aplicativo portátil ausente. Reinstale o pacote.");
  process.exit(1);
}

const child = spawn(executable, process.argv.slice(2), {
  detached: true,
  stdio: "ignore"
});
child.on("error", (error) => {
  console.error(`pulsetray: não foi possível iniciar: ${error.message}`);
  process.exitCode = 1;
});
child.unref();
