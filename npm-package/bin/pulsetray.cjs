#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const pkg = require("../package.json");
const {
  checkForUpdate,
  prepareUpdate,
  readRuntimeManifest
} = require("../scripts/npm-auto-update.cjs");

function option(args, name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function executablePath() {
  return process.platform === "darwin"
    ? path.join(__dirname, "..", "native", "iTransform Pulse.app", "Contents", "MacOS", "iTransform Pulse")
    : path.join(__dirname, "..", "native", "iTransform Pulse.exe");
}

function launchApp(args) {
  const executable = executablePath();
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error(`sistema não suportado: ${process.platform}`);
  }
  if (!fs.existsSync(executable)) throw new Error("aplicativo portátil ausente. Reinstale o pacote.");
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.on("error", (error) => {
    console.error(`pulsetray: não foi possível iniciar: ${error.message}`);
    process.exitCode = 1;
  });
  child.unref();
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`iTransform Pulse ${pkg.version}

Uso:
  pulsetray             Inicia o aplicativo
  pulsetray --help      Mostra esta ajuda
  pulsetray --version   Mostra a versão`);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`iTransform Pulse ${pkg.version}`);
    return;
  }
  const runtime = readRuntimeManifest(path.resolve(__dirname, ".."));
  if (args.includes("--internal-auto-update-check")) {
    console.log(JSON.stringify(await checkForUpdate(runtime, pkg.version)));
    return;
  }
  if (args.includes("--internal-auto-update-prepare")) {
    await prepareUpdate({
      runtime,
      currentVersion: pkg.version,
      targetVersion: option(args, "--update-target") || "",
      parentPid: Number(option(args, "--update-parent-pid")),
      updateId: option(args, "--update-id") || ""
    });
    return;
  }
  launchApp(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`pulsetray: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { executablePath, launchApp, main, option };
