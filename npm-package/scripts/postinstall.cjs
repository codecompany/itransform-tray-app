#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error(`[pulsetray] erro: ${message}`);
  process.exit(1);
}

function target(platform, arch, version) {
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    return `PulseTray-${version}-mac-${arch}.zip`;
  }
  if (platform === "win32" && arch === "x64") {
    return `PulseTray-${version}-windows-x64-portable.exe`;
  }
  return null;
}

function headers(url) {
  const token = (
    process.env.PULSETRAY_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    ""
  ).trim();
  const hostname = new URL(url).hostname.toLowerCase();
  const isGitHub = hostname === "github.com" || hostname.endsWith(".github.com");
  return {
    "User-Agent": "@code-company/pulsetray postinstall",
    ...(token && isGitHub ? { Authorization: `Bearer ${token}` } : {})
  };
}

function request(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith("http://") ? http : https;
    const req = transport.get(url, { headers: headers(url) }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
        const next = new URL(response.headers.location, url).toString();
        response.resume();
        resolve(request(next, redirects - 1));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`HTTP ${status} para ${url}`));
        return;
      }
      resolve(response);
    });
    req.on("error", reject);
  });
}

async function text(url) {
  const response = await request(url);
  return new Promise((resolve, reject) => {
    let value = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { value += chunk; });
    response.on("end", () => resolve(value));
    response.on("error", reject);
  });
}

function checksum(contents, asset) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && path.basename(match[2]) === asset) return match[1].toLowerCase();
  }
  return null;
}

async function download(url, destination, expected) {
  const response = await request(url);
  const temporary = `${destination}.download`;
  const hash = crypto.createHash("sha256");
  const output = fs.createWriteStream(temporary, { mode: 0o755 });
  await new Promise((resolve, reject) => {
    response.on("data", (chunk) => hash.update(chunk));
    response.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    response.pipe(output);
  });
  const actual = hash.digest("hex");
  if (actual !== expected) {
    await fs.promises.rm(temporary, { force: true });
    throw new Error(`SHA-256 inválido: esperado ${expected}, obtido ${actual}`);
  }
  await fs.promises.rename(temporary, destination);
}

async function install(downloaded, root) {
  const next = `${root}.next-${process.pid}`;
  const previous = `${root}.previous-${process.pid}`;
  await fs.promises.rm(next, { recursive: true, force: true });
  await fs.promises.mkdir(next, { recursive: true });
  if (process.platform === "darwin") {
    const result = spawnSync("/usr/bin/ditto", ["-x", "-k", downloaded, next], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("não foi possível extrair o pacote macOS");
  } else {
    await fs.promises.rename(downloaded, path.join(next, "PulseTray.exe"));
  }
  const executable = process.platform === "darwin"
    ? path.join(next, "PulseTray.app", "Contents", "MacOS", "PulseTray")
    : path.join(next, "PulseTray.exe");
  if (!fs.existsSync(executable)) throw new Error("o artefato portátil não contém o executável PulseTray");
  await fs.promises.rm(previous, { recursive: true, force: true });
  if (fs.existsSync(root)) await fs.promises.rename(root, previous);
  try {
    await fs.promises.rename(next, root);
    await fs.promises.rm(previous, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(previous)) await fs.promises.rename(previous, root);
    throw error;
  }
}

async function main() {
  const pkg = require("../package.json");
  const asset = target(process.platform, process.arch, pkg.version);
  if (!asset) fail(`plataforma/arquitetura não suportada: ${process.platform}/${process.arch}`);
  const repo = process.env.PULSETRAY_GITHUB_REPO || "codecompany/itransform-tray-app";
  const tag = process.env.PULSETRAY_RELEASE_TAG || `v${pkg.version}`;
  const base = process.env.PULSETRAY_RELEASE_BASE_URL ||
    `https://github.com/${repo}/releases/download/${tag}`;
  const packageRoot = path.resolve(__dirname, "..");
  const staging = path.join(packageRoot, `.pulsetray-${process.pid}`);
  await fs.promises.mkdir(staging, { recursive: true });
  const downloaded = path.join(staging, asset);
  console.log(`[pulsetray] baixando ${asset}`);
  try {
    const sums = await text(`${base}/SHA256SUMS.txt`);
    const expected = checksum(sums, asset);
    if (!expected) throw new Error(`checksum ausente para ${asset}`);
    await download(`${base}/${asset}`, downloaded, expected);
    await install(downloaded, path.join(packageRoot, "native"));
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
  console.log("[pulsetray] aplicativo portátil instalado e validado");
}

main().catch((error) => fail(error?.message || String(error)));
