import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const manifestName = ".pulsetray-runtime.json";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const checkInterval = 6 * 60 * 60_000;
const retryBackoff = 24 * 60 * 60_000;

export interface NpmRuntime {
  formatVersion: 1;
  packageName: "@code-company/pulsetray";
  packageRoot: string;
  prefix: string;
  nodeExecPath: string;
  npmExecPath: string;
  launcherScript: string;
}

interface UpdateState {
  formatVersion: 1;
  checks: number;
  available: number;
  succeeded: number;
  failed: number;
  deferred: number;
  retryAfter?: string;
  lastResult?: string;
  lastUpdateId?: string;
  lastTargetVersion?: string;
}

interface UpdaterOptions {
  execPath: string;
  userDataPath: string;
  currentVersion: string;
  args: string[];
  canRestart(): boolean;
  quit(): void;
  initialDelayMs?: number;
}

function absolute(value: unknown): value is string {
  return typeof value === "string" && path.isAbsolute(value);
}

export function packageRootFromExecutable(execPath: string): string | undefined {
  let current = path.dirname(path.resolve(execPath));
  for (let depth = 0; depth < 8; depth += 1) {
    if (path.basename(current) === "native") return path.dirname(current);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

export function parseRuntimeManifest(value: unknown, packageRoot: string): NpmRuntime {
  const input = value as Partial<NpmRuntime>;
  const root = path.resolve(packageRoot);
  if (
    input?.formatVersion !== 1 ||
    input.packageName !== "@code-company/pulsetray" ||
    !absolute(input.packageRoot) ||
    !absolute(input.prefix) ||
    !absolute(input.nodeExecPath) ||
    !absolute(input.npmExecPath) ||
    !absolute(input.launcherScript) ||
    path.resolve(input.packageRoot) !== root ||
    path.resolve(input.launcherScript) !== path.join(root, "bin", "pulsetray.cjs") ||
    path.relative(input.prefix, root).startsWith("..")
  ) {
    throw new Error("Invalid PulseTray npm runtime manifest.");
  }
  return input as NpmRuntime;
}

function loadRuntime(execPath: string): NpmRuntime | undefined {
  const root = packageRootFromExecutable(execPath);
  if (!root) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, manifestName), "utf8"));
    const runtime = parseRuntimeManifest(value, root);
    if (![runtime.nodeExecPath, runtime.npmExecPath, runtime.launcherScript]
      .every((file) => fs.existsSync(file))) return undefined;
    return runtime;
  } catch {
    return undefined;
  }
}

function option(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function startupUpdateResult(args: string[]): {
  result: "success" | "failed";
  updateId: string;
  version: string;
} | undefined {
  const result = option(args, "--update-result");
  const updateId = option(args, "--update-id");
  const version = result === "success"
    ? option(args, "--updated-from")
    : option(args, "--update-target");
  if (
    (result !== "success" && result !== "failed") ||
    !updateId?.match(/^[a-f0-9-]{16,64}$/) ||
    !version?.match(stableVersion)
  ) return undefined;
  return { result, updateId, version };
}

function stateFrom(file: string): UpdateState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as UpdateState;
    const counters = [
      parsed.checks,
      parsed.available,
      parsed.succeeded,
      parsed.failed,
      parsed.deferred
    ];
    if (
      parsed.formatVersion === 1 &&
      counters.every((value) => Number.isSafeInteger(value) && value >= 0)
    ) return parsed;
  } catch {
    // A missing or damaged diagnostics file must not block an update.
  }
  return { formatVersion: 1, checks: 0, available: 0, succeeded: 0, failed: 0, deferred: 0 };
}

function writeState(file: string, state: UpdateState): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function firstMessage(child: ChildProcess, timeout: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("npm update helper timed out"));
    }, timeout);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 8_192) child.kill();
      const newline = output.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(output.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (!output.includes("\n")) reject(new Error(`npm update helper exited with ${code}`));
    });
  });
}

export class NpmAutoUpdater {
  private readonly runtime: NpmRuntime | undefined;
  private readonly stateFile: string;
  private readonly logFile: string;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly options: UpdaterOptions) {
    this.runtime = loadRuntime(options.execPath);
    this.stateFile = path.join(options.userDataPath, "pulse-update-state.json");
    this.logFile = path.join(options.userDataPath, "pulse-update.log");
    const startup = startupUpdateResult(options.args);
    if (startup) {
      this.record(startup.result === "success" ? "succeeded" : "failed", {
        updateId: startup.updateId,
        version: startup.result === "success" ? options.currentVersion : startup.version,
        retry: startup.result === "failed"
      });
    }
  }

  start(): void {
    if (!this.runtime || this.timer) return;
    this.schedule(this.options.initialDelayMs ?? 60_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async checkNow(): Promise<void> {
    if (!this.runtime || this.running) return;
    const state = stateFrom(this.stateFile);
    if (state.retryAfter && Date.parse(state.retryAfter) > Date.now()) {
      this.schedule(Date.parse(state.retryAfter) - Date.now());
      return;
    }
    this.running = true;
    const updateId = randomUUID();
    this.log("npm_auto_update_check", "started", updateId);
    try {
      const check = await this.invoke(["--internal-auto-update-check"], 30_000);
      if (
        (check.status !== "current" && check.status !== "available") ||
        check.currentVersion !== this.options.currentVersion ||
        typeof check.latestVersion !== "string" ||
        !stableVersion.test(check.latestVersion)
      ) throw new Error("invalid npm update response");
      this.record("checks", { updateId, version: check.latestVersion });
      if (check.status === "current") {
        this.log("npm_auto_update_check", "current", updateId, check.latestVersion);
        return;
      }
      this.record("available", { updateId, version: check.latestVersion });
      if (!this.options.canRestart()) {
        this.record("deferred", { updateId, version: check.latestVersion });
        this.schedule(15 * 60_000);
        return;
      }
      await this.prepare(updateId, check.latestVersion);
    } catch {
      this.record("failed", { updateId, version: this.options.currentVersion, retry: true });
      this.log("npm_auto_update_failed", "check", updateId);
    } finally {
      this.running = false;
      if (!this.timer) this.schedule(checkInterval);
    }
  }

  private async prepare(updateId: string, targetVersion: string): Promise<void> {
    if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > 1_048_576) {
      fs.rmSync(`${this.logFile}.1`, { force: true });
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    }
    const log = fs.openSync(this.logFile, "a", 0o600);
    const child = spawn(this.runtime!.nodeExecPath, [
      this.runtime!.launcherScript,
      "--internal-auto-update-prepare",
      `--update-target=${targetVersion}`,
      `--update-parent-pid=${process.pid}`,
      `--update-id=${updateId}`
    ], { detached: true, stdio: ["pipe", "pipe", log] });
    fs.closeSync(log);
    const result = await firstMessage(child, 15 * 60_000);
    if (result.status !== "prepared") {
      this.record("failed", { updateId, version: targetVersion, retry: true });
      return;
    }
    if (!this.options.canRestart()) {
      child.stdin?.end("abort\n");
      this.record("deferred", { updateId, version: targetVersion });
      this.schedule(15 * 60_000);
      return;
    }
    this.log("npm_auto_update_apply", "prepared", updateId, targetVersion);
    child.stdin?.end("commit\n");
    child.stdout?.destroy();
    child.unref();
    this.options.quit();
  }

  private async invoke(args: string[], timeout: number): Promise<Record<string, unknown>> {
    const child = spawn(this.runtime!.nodeExecPath, [this.runtime!.launcherScript, ...args], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    return firstMessage(child, timeout);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.checkNow();
    }, delay);
  }

  private record(
    event: "checks" | "available" | "succeeded" | "failed" | "deferred",
    data: { updateId: string; version: string; retry?: boolean } | {
      result: "success" | "failed"; updateId: string; version: string;
    }
  ): void {
    const state = stateFrom(this.stateFile);
    state[event] = Math.min(1_000_000_000, state[event] + 1);
    state.lastResult = event;
    state.lastUpdateId = data.updateId;
    state.lastTargetVersion = data.version;
    state.retryAfter = "retry" in data && data.retry
      ? new Date(
          Date.now() + retryBackoff + Math.floor(Math.random() * 60 * 60_000)
        ).toISOString()
      : undefined;
    writeState(this.stateFile, state);
    this.log("npm_auto_update_result", event, data.updateId, data.version);
  }

  private log(event: string, status: string, updateId: string, version?: string): void {
    console.info(JSON.stringify({
      event,
      status,
      update_id: updateId,
      ...(version ? { version } : {})
    }));
  }
}
