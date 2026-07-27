"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PACKAGE_NAME = "@code-company/pulsetray";
const REGISTRY = "https://registry.npmjs.org";
const MANIFEST_NAME = ".pulsetray-runtime.json";
const MAX_OUTPUT = 64 * 1024;

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error("invalid stable version");
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error("version overflow");
  return parts;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function assertAbsolute(value, field) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`invalid ${field}`);
  }
  return path.resolve(value);
}

function createRuntimeManifest(packageRoot, env = process.env) {
  const root = path.resolve(packageRoot);
  const configuredPrefix = typeof env.npm_config_prefix === "string" &&
    path.isAbsolute(env.npm_config_prefix)
    ? path.resolve(env.npm_config_prefix)
    : "";
  const derivedPrefix = process.platform === "win32"
    ? path.resolve(root, "..", "..", "..")
    : path.resolve(root, "..", "..", "..", "..");
  const prefix = path.relative(configuredPrefix, root).startsWith("..")
    ? derivedPrefix
    : configuredPrefix;
  const npmExecPath = assertAbsolute(env.npm_execpath, "npm executable");
  const nodeExecPath = assertAbsolute(env.npm_node_execpath || process.execPath, "node executable");
  return {
    formatVersion: 1,
    packageName: PACKAGE_NAME,
    packageRoot: root,
    prefix,
    nodeExecPath,
    npmExecPath,
    launcherScript: path.join(root, "bin", "pulsetray.cjs")
  };
}

function validateRuntimeManifest(value, expectedRoot) {
  if (!value || value.formatVersion !== 1 || value.packageName !== PACKAGE_NAME) {
    throw new Error("invalid runtime manifest");
  }
  const runtime = {
    ...value,
    packageRoot: assertAbsolute(value.packageRoot, "package root"),
    prefix: assertAbsolute(value.prefix, "npm prefix"),
    nodeExecPath: assertAbsolute(value.nodeExecPath, "node executable"),
    npmExecPath: assertAbsolute(value.npmExecPath, "npm executable"),
    launcherScript: assertAbsolute(value.launcherScript, "launcher")
  };
  const root = path.resolve(expectedRoot);
  if (runtime.packageRoot !== root) throw new Error("runtime package root mismatch");
  if (runtime.launcherScript !== path.join(root, "bin", "pulsetray.cjs")) {
    throw new Error("runtime launcher mismatch");
  }
  if (path.relative(runtime.prefix, root).startsWith("..")) {
    throw new Error("runtime package escaped the npm prefix");
  }
  for (const file of [runtime.nodeExecPath, runtime.npmExecPath, runtime.launcherScript]) {
    if (!fs.existsSync(file)) throw new Error("runtime executable is missing");
  }
  return runtime;
}

function writeRuntimeManifest(packageRoot, runtime = createRuntimeManifest(packageRoot)) {
  const file = path.join(packageRoot, MANIFEST_NAME);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporary, file);
}

function readRuntimeManifest(packageRoot) {
  const file = path.join(packageRoot, MANIFEST_NAME);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  return validateRuntimeManifest(value, packageRoot);
}

function packageRootForPrefix(prefix, platform = process.platform) {
  const base = platform === "win32"
    ? path.join(prefix, "node_modules")
    : path.join(prefix, "lib", "node_modules");
  return path.join(base, "@code-company", "pulsetray");
}

function childEnvironment() {
  const allowed = [
    "APPDATA", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS", "NO_PROXY", "PATH", "Path", "PATHEXT",
    "SSL_CERT_DIR", "SSL_CERT_FILE", "SYSTEMROOT", "SystemRoot", "TEMP",
    "TMP", "TMPDIR", "USERPROFILE", "http_proxy", "https_proxy", "no_proxy",
    "HTTP_PROXY", "HTTPS_PROXY"
  ];
  return Object.fromEntries(allowed.flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]]
  ));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || childEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), options.timeout || 30_000);
    const collect = (current, chunk) => {
      const next = current + chunk;
      if (next.length > MAX_OUTPUT) child.kill();
      return next.slice(0, MAX_OUTPUT);
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`child process failed with exit ${code}: ${stderr.trim()}`));
    });
  });
}

async function checkForUpdate(runtime, currentVersion, runProcess = run) {
  versionParts(currentVersion);
  const output = await runProcess(runtime.nodeExecPath, [
    runtime.npmExecPath,
    "view",
    `${PACKAGE_NAME}@latest`,
    "version",
    "--json",
    `--registry=${REGISTRY}`
  ]);
  const latestVersion = JSON.parse(output);
  versionParts(latestVersion);
  return {
    status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
    currentVersion,
    latestVersion
  };
}

function waitForCommand(timeout = 5 * 60_000, input = process.stdin) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("update approval timed out")), timeout);
    input.setEncoding("utf8");
    input.once("data", (value) => {
      clearTimeout(timer);
      const command = value.trim();
      if (command === "commit" || command === "abort") resolve(command);
      else reject(new Error("invalid update approval"));
    });
  });
}

async function waitForExit(pid, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("desktop process did not exit");
}

function launch(runtime, args) {
  const child = spawn(runtime.nodeExecPath, [runtime.launcherScript, ...args], {
    detached: true,
    env: childEnvironment(),
    shell: false,
    stdio: "ignore"
  });
  child.unref();
}

async function stagePackage(input, paths, runProcess) {
  const { runtime } = input;
  await fs.promises.rm(paths.stagePrefix, { recursive: true, force: true });
  await runProcess(runtime.nodeExecPath, [
    runtime.npmExecPath,
    "install",
    "--global",
    "--no-audit",
    "--no-fund",
    `--prefix=${paths.stagePrefix}`,
    `--registry=${REGISTRY}`,
    `${PACKAGE_NAME}@${input.targetVersion}`
  ], { timeout: 15 * 60_000 });
  const stagedPackage = JSON.parse(
    await fs.promises.readFile(path.join(paths.stagedRoot, "package.json"), "utf8")
  );
  if (stagedPackage.name !== PACKAGE_NAME || stagedPackage.version !== input.targetVersion) {
    throw new Error("staged package does not match the requested version");
  }
  readRuntimeManifest(paths.stagedRoot);
  writeRuntimeManifest(paths.stagedRoot, {
    ...runtime,
    packageRoot: runtime.packageRoot,
    launcherScript: path.join(runtime.packageRoot, "bin", "pulsetray.cjs")
  });
}

async function swapPackage(input, paths, waitExit, launchApp) {
  const { runtime } = input;
  let parentExited = false;
  try {
    await waitExit(input.parentPid);
    parentExited = true;
    await fs.promises.rm(paths.backup, { recursive: true, force: true });
    await fs.promises.rename(runtime.packageRoot, paths.backup);
    try {
      await fs.promises.rename(paths.stagedRoot, runtime.packageRoot);
      readRuntimeManifest(runtime.packageRoot);
    } catch (error) {
      await fs.promises.rm(runtime.packageRoot, { recursive: true, force: true });
      await fs.promises.rename(paths.backup, runtime.packageRoot);
      throw error;
    }
    await fs.promises.rm(paths.backup, { recursive: true, force: true });
    launchApp(runtime, [
      "--hidden",
      "--update-result=success",
      `--updated-from=${input.currentVersion}`,
      `--update-id=${input.updateId}`
    ]);
    return "updated";
  } catch (error) {
    console.error(`[pulsetray] atualização falhou: ${error.message}`);
    if (parentExited) {
      launchApp(runtime, [
        "--hidden",
        "--update-result=failed",
        `--update-target=${input.targetVersion}`,
        `--update-id=${input.updateId}`
      ]);
    }
    return "failed";
  }
}

async function prepareUpdate(input, dependencies = {}) {
  versionParts(input.targetVersion);
  if (compareVersions(input.targetVersion, input.currentVersion) <= 0) {
    throw new Error("target version is not newer");
  }
  if (!/^[a-f0-9-]{16,64}$/.test(input.updateId) ||
      !Number.isSafeInteger(input.parentPid) || input.parentPid <= 0) {
    throw new Error("invalid update identity");
  }
  const paths = {
    stagePrefix: path.join(input.runtime.prefix, `.pulsetray-stage-${input.updateId}`),
    backup: path.join(
      path.dirname(input.runtime.packageRoot),
      `.pulsetray-backup-${input.updateId}`
    )
  };
  paths.stagedRoot = packageRootForPrefix(paths.stagePrefix);
  try {
    await stagePackage(input, paths, dependencies.runProcess || run);
    process.stdout.write(`${JSON.stringify({ status: "prepared", updateId: input.updateId })}\n`);
    if (await (dependencies.waitForCommand || waitForCommand)() === "abort") return "aborted";
    return swapPackage(
      input,
      paths,
      dependencies.waitForExit || waitForExit,
      dependencies.launchApp || launch
    );
  } catch {
    process.stdout.write(`${JSON.stringify({ status: "failed", updateId: input.updateId })}\n`);
    return "failed";
  } finally {
    await fs.promises.rm(paths.stagePrefix, { recursive: true, force: true });
  }
}

module.exports = {
  MANIFEST_NAME,
  PACKAGE_NAME,
  checkForUpdate,
  childEnvironment,
  compareVersions,
  createRuntimeManifest,
  launch,
  packageRootForPrefix,
  prepareUpdate,
  readRuntimeManifest,
  run,
  validateRuntimeManifest,
  versionParts,
  waitForCommand,
  waitForExit,
  writeRuntimeManifest
};
