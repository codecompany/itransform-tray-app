import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NpmAutoUpdater,
  packageRootFromExecutable,
  parseRuntimeManifest,
  startupUpdateResult
} from "./npm-auto-update.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(options: {
  canRestart: () => boolean;
  status?: unknown;
  latestVersion?: unknown;
  responseCurrentVersion?: unknown;
  prepareStatus?: string;
  args?: string[];
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulsetray-electron-update-"));
  temporaryDirectories.push(root);
  const packageRoot = path.join(root, "lib", "node_modules", "@code-company", "pulsetray");
  const launcherScript = path.join(packageRoot, "bin", "pulsetray.cjs");
  const marker = path.join(root, "commit");
  fs.mkdirSync(path.dirname(launcherScript), { recursive: true });
  fs.writeFileSync(launcherScript, `
    const fs = require("node:fs");
    if (process.argv.includes("--internal-auto-update-check")) {
      console.log(JSON.stringify({
        status: ${JSON.stringify(options.status ?? "available")},
        currentVersion: ${JSON.stringify(options.responseCurrentVersion ?? "1.2.3")},
        latestVersion: ${JSON.stringify(options.latestVersion ?? "1.2.4")}
      }));
    } else {
      const id = process.argv.find((value) => value.startsWith("--update-id=")).slice(12);
      console.log(JSON.stringify({
        status: ${JSON.stringify(options.prepareStatus ?? "prepared")},
        updateId: id
      }));
      if (${JSON.stringify(options.prepareStatus ?? "prepared")} !== "prepared") process.exit(0);
      process.stdin.once("data", (value) => {
        fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
          command: value.toString().trim(),
          args: process.argv.slice(2)
        }));
        process.exit(0);
      });
    }
  `);
  fs.writeFileSync(path.join(packageRoot, ".pulsetray-runtime.json"), JSON.stringify({
    formatVersion: 1,
    packageName: "@code-company/pulsetray",
    packageRoot,
    prefix: root,
    nodeExecPath: process.execPath,
    npmExecPath: process.execPath,
    launcherScript
  }));
  const execPath = path.join(
    packageRoot,
    "native",
    "iTransform Pulse.app",
    "Contents",
    "MacOS",
    "iTransform Pulse"
  );
  let quit = false;
  const instance = new NpmAutoUpdater({
    execPath,
    userDataPath: root,
    currentVersion: "1.2.3",
    args: options.args ?? [],
    canRestart: options.canRestart,
    quit: () => { quit = true; },
    initialDelayMs: 60_000
  });
  return { instance, marker, quit: () => quit, root };
}

describe("NpmAutoUpdater", () => {
  it("finds and validates the npm package boundary", () => {
    const executable = "/prefix/lib/node_modules/@scope/pkg/native/App.app/Contents/MacOS/App";
    expect(packageRootFromExecutable(executable)).toBe("/prefix/lib/node_modules/@scope/pkg");
    const root = "/prefix/lib/node_modules/@code-company/pulsetray";
    expect(() => parseRuntimeManifest({
      formatVersion: 1,
      packageName: "@code-company/pulsetray",
      packageRoot: root,
      prefix: "/other",
      nodeExecPath: "/node",
      npmExecPath: "/npm",
      launcherScript: `${root}/bin/pulsetray.cjs`
    }, root)).toThrow();
    expect(packageRootFromExecutable("/no/native-boundary")).toBeUndefined();
    expect(packageRootFromExecutable("/a/b/c/d/e/f/g/h/i/j")).toBeUndefined();
    const valid = {
      formatVersion: 1,
      packageName: "@code-company/pulsetray",
      packageRoot: root,
      prefix: "/prefix",
      nodeExecPath: "/node",
      npmExecPath: "/npm",
      launcherScript: `${root}/bin/pulsetray.cjs`
    };
    expect(parseRuntimeManifest(valid, root)).toEqual(valid);
    const invalid = [
      null,
      { ...valid, formatVersion: 2 },
      { ...valid, packageName: "@other/app" },
      { ...valid, packageRoot: "/prefix/other" },
      { ...valid, packageRoot: "relative" },
      { ...valid, prefix: "relative" },
      { ...valid, prefix: "/other" },
      { ...valid, nodeExecPath: "relative" },
      { ...valid, npmExecPath: "relative" },
      { ...valid, launcherScript: "relative" },
      { ...valid, launcherScript: `${root}/bin/other.cjs` }
    ];
    for (const manifest of invalid) {
      expect(() => parseRuntimeManifest(manifest, root)).toThrow(
        "Invalid PulseTray npm runtime manifest."
      );
    }
  });

  it("parses only bounded startup outcomes", () => {
    expect(startupUpdateResult([
      "--update-result=success",
      "--updated-from=1.2.3",
      "--update-id=12345678-1234-1234-1234-123456789abc"
    ])).toMatchObject({ result: "success", version: "1.2.3" });
    expect(startupUpdateResult([
      "--update-result=failed",
      "--update-target=1.2.4",
      "--update-id=abcdef12-1234-1234-1234-123456789abc"
    ])).toEqual({
      result: "failed",
      updateId: "abcdef12-1234-1234-1234-123456789abc",
      version: "1.2.4"
    });
    const id = "12345678-1234-1234-1234-123456789abc";
    const invalid = [
      [],
      [`--update-result=unknown`, "--updated-from=1.2.3", `--update-id=${id}`],
      ["--update-result=success", "--updated-from=latest", `--update-id=${id}`],
      ["--update-result=success", "--updated-from=01.2.3", `--update-id=${id}`],
      ["--update-result=success", "--updated-from=1.2.3-beta", `--update-id=${id}`],
      ["--update-result=success", "--updated-from=1.2.3", "--update-id=short"],
      ["--update-result=success", "--updated-from=1.2.3", `--update-id=${"a".repeat(65)}`],
      ["--update-result=success", "--updated-from=1.2.3", `--update-id=!${"a".repeat(16)}`],
      ["--update-result=success", "--updated-from=1.2.3", `--update-id=${"a".repeat(16)}!`]
    ];
    for (const args of invalid) expect(startupUpdateResult(args)).toBeUndefined();
  });

  it("commits a prepared update only when restart is safe", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const prepared = fixture({ canRestart: () => true });
    await prepared.instance.checkNow();
    expect(prepared.quit()).toBe(true);
    await vi.waitFor(() => expect(fs.existsSync(prepared.marker)).toBe(true));
    const application = JSON.parse(fs.readFileSync(prepared.marker, "utf8"));
    const state = JSON.parse(
      fs.readFileSync(path.join(prepared.root, "pulse-update-state.json"), "utf8")
    );
    expect(application).toEqual({
      command: "commit",
      args: [
        "--internal-auto-update-prepare",
        "--update-target=1.2.4",
        `--update-parent-pid=${process.pid}`,
        `--update-id=${state.lastUpdateId}`
      ]
    });
  });

  it("defers an available update while a renderer blocks restart", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const deferred = fixture({ canRestart: () => false });
    await deferred.instance.checkNow();
    const state = JSON.parse(
      fs.readFileSync(path.join(deferred.root, "pulse-update-state.json"), "utf8")
    );
    expect(deferred.quit()).toBe(false);
    expect(state.deferred).toBe(1);
    deferred.instance.stop();
  });

  it("records current, invalid, and failed preparation outcomes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const current = fixture({ canRestart: () => true, status: "current", latestVersion: "1.2.3" });
    await current.instance.checkNow();
    expect(JSON.parse(
      fs.readFileSync(path.join(current.root, "pulse-update-state.json"), "utf8")
    )).toMatchObject({ checks: 1, available: 0, failed: 0 });
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(current.root, "pulse-update-state.json")).mode & 0o777)
        .toBe(0o600);
    }

    const invalid = fixture({ canRestart: () => true, status: "unexpected" });
    await invalid.instance.checkNow();
    expect(JSON.parse(
      fs.readFileSync(path.join(invalid.root, "pulse-update-state.json"), "utf8")
    ).failed).toBe(1);

    const failed = fixture({ canRestart: () => true, prepareStatus: "failed" });
    await failed.instance.checkNow();
    expect(JSON.parse(
      fs.readFileSync(path.join(failed.root, "pulse-update-state.json"), "utf8")
    )).toMatchObject({ available: 1, failed: 1 });
  });

  it.each([
    [{ status: 1 }, "non-string status"],
    [{ responseCurrentVersion: "1.2.2" }, "mismatched current version"],
    [{ latestVersion: 123 }, "non-string latest version"],
    [{ latestVersion: "latest" }, "tagged latest version"],
    [{ latestVersion: "01.2.4" }, "zero-prefixed latest version"],
    [{ latestVersion: "1.2.4-beta" }, "prerelease latest version"]
  ])("rejects an invalid npm response: %s", async (response, _label) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const invalid = fixture({ canRestart: () => true, ...response });
    await invalid.instance.checkNow();
    expect(JSON.parse(
      fs.readFileSync(path.join(invalid.root, "pulse-update-state.json"), "utf8")
    )).toMatchObject({ checks: 0, available: 0, failed: 1 });
    invalid.instance.stop();
  });

  it.each([
    { formatVersion: 2 },
    { checks: -1 },
    { available: 1.5 },
    { succeeded: -1 },
    { failed: Number.MAX_SAFE_INTEGER + 1 },
    { deferred: "1" }
  ])("recovers from unsafe persisted diagnostics %#", async (change) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const current = fixture({
      canRestart: () => true,
      status: "current",
      latestVersion: "1.2.3"
    });
    fs.writeFileSync(path.join(current.root, "pulse-update-state.json"), JSON.stringify({
      formatVersion: 1,
      checks: 0,
      available: 0,
      succeeded: 0,
      failed: 0,
      deferred: 0,
      ...change
    }));
    await current.instance.checkNow();
    expect(JSON.parse(
      fs.readFileSync(path.join(current.root, "pulse-update-state.json"), "utf8")
    )).toMatchObject({
      formatVersion: 1,
      checks: 1,
      available: 0,
      succeeded: 0,
      failed: 0,
      deferred: 0
    });
    current.instance.stop();
  });

  it("honors retry backoff and start-stop timer ownership", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const update = fixture({ canRestart: () => true });
    const stateFile = path.join(update.root, "pulse-update-state.json");
    fs.writeFileSync(stateFile, JSON.stringify({
      formatVersion: 1,
      checks: 0,
      available: 0,
      succeeded: 0,
      failed: 1,
      deferred: 0,
      retryAfter: new Date(Date.now() + 60_000).toISOString()
    }));
    update.instance.start();
    update.instance.start();
    expect(vi.getTimerCount()).toBe(1);
    await update.instance.checkNow();
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8")).checks).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    update.instance.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks immediately when retry backoff expires at the current instant", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const now = Date.parse("2026-07-27T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const update = fixture({
      canRestart: () => true,
      status: "current",
      latestVersion: "1.2.3"
    });
    const stateFile = path.join(update.root, "pulse-update-state.json");
    fs.writeFileSync(stateFile, JSON.stringify({
      formatVersion: 1,
      checks: 0,
      available: 0,
      succeeded: 0,
      failed: 1,
      deferred: 0,
      retryAfter: new Date(now).toISOString()
    }));
    await update.instance.checkNow();
    expect(JSON.parse(fs.readFileSync(stateFile, "utf8")).checks).toBe(1);
    update.instance.stop();
  });

  it("aborts a staged update when restart becomes unsafe", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let checks = 0;
    const staged = fixture({ canRestart: () => (checks += 1) === 1 });
    await staged.instance.checkNow();
    expect(staged.quit()).toBe(false);
    expect(JSON.parse(
      fs.readFileSync(path.join(staged.root, "pulse-update-state.json"), "utf8")
    ).deferred).toBe(1);
    await vi.waitFor(() => expect(fs.existsSync(staged.marker)).toBe(true));
    expect(JSON.parse(fs.readFileSync(staged.marker, "utf8")).command).toBe("abort");
    staged.instance.stop();
  });

  it("records startup failure backoff and disables outside npm installs", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const now = Date.parse("2026-07-27T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const failed = fixture({
      canRestart: () => true,
      args: [
        "--update-result=failed",
        "--update-target=1.2.4",
        "--update-id=12345678-1234-1234-1234-123456789abc"
      ]
    });
    failed.instance.start();
    await failed.instance.checkNow();
    failed.instance.stop();
    expect(JSON.parse(
      fs.readFileSync(path.join(failed.root, "pulse-update-state.json"), "utf8")
    )).toMatchObject({
      failed: 1,
      lastResult: "failed",
      retryAfter: new Date(now + 24.5 * 60 * 60_000).toISOString()
    });

    const disabled = new NpmAutoUpdater({
      execPath: path.join(failed.root, "standalone", "Pulse"),
      userDataPath: failed.root,
      currentVersion: "1.2.3",
      args: [],
      canRestart: () => true,
      quit: () => { throw new Error("must not quit"); }
    });
    disabled.start();
    await disabled.checkNow();
    disabled.stop();
  });

  it("records a successful startup outcome against the running version", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const succeeded = fixture({
      canRestart: () => true,
      args: [
        "--update-result=success",
        "--updated-from=1.2.2",
        "--update-id=abcdef12-1234-1234-1234-123456789abc"
      ]
    });
    const state = JSON.parse(
      fs.readFileSync(path.join(succeeded.root, "pulse-update-state.json"), "utf8")
    );
    expect(state).toMatchObject({
      succeeded: 1,
      failed: 0,
      lastResult: "succeeded",
      lastUpdateId: "abcdef12-1234-1234-1234-123456789abc",
      lastTargetVersion: "1.2.3"
    });
    expect(state.retryAfter).toBeUndefined();
  });

  it("rotates a bounded helper log before preparing an update", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const update = fixture({ canRestart: () => true });
    const log = path.join(update.root, "pulse-update.log");
    fs.writeFileSync(log, Buffer.alloc(1_048_577, 1));
    await update.instance.checkNow();
    await vi.waitFor(() => expect(fs.existsSync(update.marker)).toBe(true));
    expect(fs.statSync(`${log}.1`).size).toBe(1_048_577);
    expect(fs.existsSync(log)).toBe(true);
  });

  it("does not rotate a helper log at the exact size boundary", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const update = fixture({ canRestart: () => true });
    const log = path.join(update.root, "pulse-update.log");
    fs.writeFileSync(log, Buffer.alloc(1_048_576, 1));
    await update.instance.checkNow();
    await vi.waitFor(() => expect(fs.existsSync(update.marker)).toBe(true));
    expect(fs.existsSync(`${log}.1`)).toBe(false);
  });
});
