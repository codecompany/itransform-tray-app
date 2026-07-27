import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const updater = require("../scripts/npm-auto-update.cjs");
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.PULSETRAY_TEST_SECRET;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): {
  root: string;
  runtime: Record<string, unknown>;
  prefix: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulsetray-update-test-"));
  temporaryDirectories.push(root);
  const prefix = path.join(root, "prefix");
  const packageRoot = updater.packageRootForPrefix(prefix);
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "bin", "pulsetray.cjs"), "old");
  fs.writeFileSync(path.join(packageRoot, "payload.txt"), "old");
  const nodeExecPath = path.join(root, "node");
  const npmExecPath = path.join(root, "npm.cjs");
  fs.writeFileSync(nodeExecPath, "");
  fs.writeFileSync(npmExecPath, "");
  const runtime = {
    formatVersion: 1,
    packageName: updater.PACKAGE_NAME,
    packageRoot,
    prefix,
    nodeExecPath,
    npmExecPath,
    launcherScript: path.join(packageRoot, "bin", "pulsetray.cjs")
  };
  updater.writeRuntimeManifest(packageRoot, runtime);
  return { root, runtime, prefix };
}

function stage(
  runtime: Record<string, string>,
  targetVersion: string,
  packageJson = { name: updater.PACKAGE_NAME, version: targetVersion },
  observe?: (command: string, args: string[], options: Record<string, unknown>) => void
) {
  return async (command: string, args: string[], options: Record<string, unknown> = {}) => {
    observe?.(command, args, options);
    const stagePrefix = args.find((arg) => arg.startsWith("--prefix="))!.slice(9);
    const stagedRoot = updater.packageRootForPrefix(stagePrefix);
    fs.mkdirSync(path.join(stagedRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(stagedRoot, "bin", "pulsetray.cjs"), "new");
    fs.writeFileSync(path.join(stagedRoot, "payload.txt"), "new");
    fs.writeFileSync(
      path.join(stagedRoot, "package.json"),
      JSON.stringify(packageJson)
    );
    updater.writeRuntimeManifest(stagedRoot, {
      ...runtime,
      prefix: stagePrefix,
      packageRoot: stagedRoot,
      launcherScript: path.join(stagedRoot, "bin", "pulsetray.cjs")
    });
    return "";
  };
}

async function waitUntil(predicate: () => boolean, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("npm auto update", () => {
  it.each([
    ["0.1.9", "0.1.10", -1],
    ["1.0.0", "1.0.0", 0],
    ["2.0.0", "1.99.99", 1],
    ["1.2.4", "1.3.0", -1],
    ["1.2.4", "1.2.3", 1]
  ])("compares stable versions", (left, right, expected) => {
    expect(updater.compareVersions(left, right)).toBe(expected);
  });

  it.each(["1.0", "01.0.0", "1.0.0-beta", "1.0.0.1", "latest"])(
    "rejects an unsafe version %s",
    (value) => expect(() => updater.versionParts(value)).toThrow()
  );

  it("fuzzes stable version parsing and ordering deterministically", () => {
    let seed = 0x5eed1234;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % 10_000;
    };
    for (let index = 0; index < 500; index += 1) {
      const left = [next(), next(), next()];
      const right = [next(), next(), next()];
      const firstDifference = left.findIndex((part, partIndex) => part !== right[partIndex]);
      const comparison = firstDifference === -1
        ? 0
        : Math.sign(left[firstDifference] - right[firstDifference]);
      expect(updater.versionParts(left.join("."))).toEqual(left);
      expect(updater.compareVersions(left.join("."), right.join("."))).toBe(comparison);
    }
  });

  it("creates and validates a runtime manifest inside its npm prefix", () => {
    const { runtime, prefix } = fixture();
    expect(updater.createRuntimeManifest(runtime.packageRoot, {
      npm_config_prefix: "/different",
      npm_execpath: process.execPath,
      npm_node_execpath: process.execPath
    })).toMatchObject({ prefix });
    expect(updater.createRuntimeManifest(runtime.packageRoot, {
      npm_config_prefix: prefix,
      npm_execpath: process.execPath
    })).toMatchObject({
      packageRoot: runtime.packageRoot,
      prefix,
      nodeExecPath: process.execPath,
      npmExecPath: process.execPath,
      launcherScript: runtime.launcherScript
    });
    expect(updater.packageRootForPrefix("/pulse", "darwin"))
      .toBe(path.join("/pulse", "lib", "node_modules", "@code-company", "pulsetray"));
    expect(updater.packageRootForPrefix("/pulse", "win32"))
      .toBe(path.join("/pulse", "node_modules", "@code-company", "pulsetray"));
    expect(() => updater.createRuntimeManifest(runtime.packageRoot, {
      npm_config_prefix: prefix,
      npm_execpath: "relative/npm.cjs"
    })).toThrow("npm executable");
    expect(() => updater.validateRuntimeManifest(null, runtime.packageRoot)).toThrow();
    expect(() => updater.validateRuntimeManifest(
      { ...runtime, launcherScript: path.join(prefix, "other") },
      runtime.packageRoot
    )).toThrow("launcher");
    expect(() => updater.validateRuntimeManifest(
      { ...runtime, prefix: path.join(prefix, "other") },
      runtime.packageRoot
    )).toThrow("escaped");
    expect(() => updater.versionParts(`${"9".repeat(400)}.0.0`)).toThrow("overflow");
  });

  it.each([
    ["format version", { formatVersion: 2 }],
    ["package name", { packageName: "@other/app" }],
    ["package root", { packageRoot: "/different/root" }],
    ["relative package root", { packageRoot: "relative/root" }],
    ["relative prefix", { prefix: "relative/prefix" }],
    ["relative node executable", { nodeExecPath: "relative/node" }],
    ["relative npm executable", { npmExecPath: "relative/npm" }],
    ["relative launcher", { launcherScript: "relative/launcher" }]
  ])("rejects a runtime manifest with invalid %s", (_label, change) => {
    const { runtime } = fixture();
    expect(() => updater.validateRuntimeManifest(
      { ...runtime, ...change },
      runtime.packageRoot
    )).toThrow();
  });

  it.each(["nodeExecPath", "npmExecPath", "launcherScript"])(
    "rejects a runtime manifest with missing %s",
    (field) => {
      const { runtime } = fixture();
      fs.rmSync(runtime[field] as string);
      expect(() => updater.validateRuntimeManifest(runtime, runtime.packageRoot)).toThrow(
        "executable is missing"
      );
    }
  );

  it("writes the runtime manifest atomically with owner-writable permissions", () => {
    const { runtime } = fixture();
    const manifest = path.join(runtime.packageRoot, updater.MANIFEST_NAME);
    expect(fs.readFileSync(manifest, "utf8").endsWith("\n")).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(manifest).mode & 0o777).toBe(0o644);
    }
    expect(fs.readdirSync(runtime.packageRoot).some((file) => file.endsWith(".tmp"))).toBe(false);
    expect(updater.readRuntimeManifest(runtime.packageRoot)).toMatchObject(runtime);
  });

  it("runs child commands with bounded output and a scrubbed environment", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/safe-home";
    process.env.PULSETRAY_TEST_SECRET = "hidden";
    expect(updater.childEnvironment()).toMatchObject({ HOME: "/safe-home" });
    expect(updater.childEnvironment()).not.toHaveProperty("PULSETRAY_TEST_SECRET");
    delete process.env.PULSETRAY_TEST_SECRET;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await expect(updater.run(
      process.execPath,
      ["-e", "process.stdout.write('  ok  ')"],
      { env: {} }
    )).resolves.toBe("ok");
    await expect(updater.run(
      process.execPath,
      ["-e", "process.stderr.write('bad'); process.exit(2)"],
      { env: {} }
    )).rejects.toThrow("exit 2");
    await expect(updater.run(
      process.execPath,
      ["-e", "setTimeout(() => {}, 1000)"],
      { env: {}, timeout: 5 }
    )).rejects.toThrow();
    await expect(updater.run(
      path.join(os.tmpdir(), "pulsetray-command-does-not-exist"),
      [],
      { env: {}, timeout: 100 }
    )).rejects.toThrow();
    await expect(updater.run(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(70000))"],
      { env: {} }
    )).rejects.toThrow();
  });

  it("accepts only commit or abort approval and bounds parent exit", async () => {
    const commit = new PassThrough();
    const committed = updater.waitForCommand(100, commit);
    commit.end("commit\n");
    await expect(committed).resolves.toBe("commit");
    const invalid = new PassThrough();
    const rejected = updater.waitForCommand(100, invalid);
    invalid.end("later\n");
    await expect(rejected).rejects.toThrow("invalid");
    const abort = new PassThrough();
    const aborted = updater.waitForCommand(100, abort);
    abort.end("abort\n");
    await expect(aborted).resolves.toBe("abort");
    await expect(updater.waitForCommand(1, new PassThrough())).rejects.toThrow("timed out");
    await expect(updater.waitForExit(999_999_999, 10)).resolves.toBeUndefined();
    await expect(updater.waitForExit(process.pid, 1)).rejects.toThrow("did not exit");
  });

  it("accepts only a newer npm latest version", async () => {
    const runtime = fixture().runtime;
    const calls: unknown[][] = [];
    await expect(updater.checkForUpdate(
      runtime,
      "1.2.3",
      async (...args: unknown[]) => {
        calls.push(args);
        return JSON.stringify("1.2.4");
      }
    )).resolves.toMatchObject({ status: "available", latestVersion: "1.2.4" });
    expect(calls).toEqual([[
      runtime.nodeExecPath,
      [
        runtime.npmExecPath,
        "view",
        `${updater.PACKAGE_NAME}@latest`,
        "version",
        "--json",
        "--registry=https://registry.npmjs.org"
      ]
    ]]);
    await expect(updater.checkForUpdate(
      runtime,
      "1.2.3",
      async () => JSON.stringify("1.2.3")
    )).resolves.toMatchObject({ status: "current" });
    await expect(updater.checkForUpdate(
      runtime,
      "1.2.3",
      async () => JSON.stringify("1.2.2")
    )).resolves.toMatchObject({ status: "current" });
    await expect(updater.checkForUpdate(
      runtime,
      "1.2.3",
      async () => JSON.stringify("1.2.3-beta")
    )).rejects.toThrow("invalid stable version");
  });

  it("swaps a fully staged package before relaunch", async () => {
    const { runtime, prefix } = fixture();
    const launched: string[][] = [];
    const processCalls: unknown[][] = [];
    const updateId = "12345678-1234-1234-1234-123456789abc";
    await expect(updater.prepareUpdate({
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId
    }, {
      runProcess: stage(runtime, "1.2.4", undefined, (...args) => processCalls.push(args)),
      waitForCommand: async () => "commit",
      waitForExit: async () => undefined,
      launchApp: (_runtime: unknown, args: string[]) => launched.push(args)
    })).resolves.toBe("updated");
    const stagePrefix = path.join(prefix, `.pulsetray-stage-${updateId}`);
    expect(processCalls).toEqual([[
      runtime.nodeExecPath,
      [
        runtime.npmExecPath,
        "install",
        "--global",
        "--no-audit",
        "--no-fund",
        `--prefix=${stagePrefix}`,
        "--registry=https://registry.npmjs.org",
        `${updater.PACKAGE_NAME}@1.2.4`
      ],
      { timeout: 15 * 60_000 }
    ]]);
    expect(fs.readFileSync(path.join(runtime.packageRoot, "payload.txt"), "utf8")).toBe("new");
    expect(launched).toEqual([[
      "--hidden",
      "--update-result=success",
      "--updated-from=1.2.3",
      `--update-id=${updateId}`
    ]]);
    expect(fs.existsSync(stagePrefix)).toBe(false);
  });

  it("restores the active package when post-stage validation fails", async () => {
    const { runtime, prefix } = fixture();
    const updateId = "abcdef12-1234-1234-1234-123456789abc";
    const stagedRoot = updater.packageRootForPrefix(
      path.join(prefix, `.pulsetray-stage-${updateId}`)
    );
    const launched: string[][] = [];
    await expect(updater.prepareUpdate({
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId
    }, {
      runProcess: stage(runtime, "1.2.4"),
      waitForCommand: async () => "commit",
      waitForExit: async () => {
        fs.rmSync(path.join(stagedRoot, "bin", "pulsetray.cjs"));
      },
      launchApp: (_runtime: unknown, args: string[]) => launched.push(args)
    })).resolves.toBe("failed");
    expect(fs.readFileSync(path.join(runtime.packageRoot, "payload.txt"), "utf8")).toBe("old");
    expect(launched).toEqual([[
      "--hidden",
      "--update-result=failed",
      "--update-target=1.2.4",
      `--update-id=${updateId}`
    ]]);
  });

  it.each([
    ["wrong package name", { name: "@other/app", version: "1.2.4" }],
    ["wrong package version", { name: updater.PACKAGE_NAME, version: "1.2.5" }]
  ])("rejects a staged package with %s", async (_label, packageJson) => {
    const { runtime } = fixture();
    await expect(updater.prepareUpdate({
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId: "aaaaaaa1-1234-1234-1234-123456789abc"
    }, {
      runProcess: stage(runtime, "1.2.4", packageJson),
      launchApp: () => { throw new Error("must not launch"); }
    })).resolves.toBe("failed");
    expect(fs.readFileSync(path.join(runtime.packageRoot, "payload.txt"), "utf8")).toBe("old");
  });

  it("aborts safely before replacing the active package", async () => {
    const { runtime } = fixture();
    const input = {
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId: "11111111-1234-1234-1234-123456789abc"
    };
    await expect(updater.prepareUpdate(input, {
      runProcess: stage(runtime, "1.2.4"),
      waitForCommand: async () => "abort",
      launchApp: () => { throw new Error("must not launch"); }
    })).resolves.toBe("aborted");
    expect(fs.readFileSync(path.join(runtime.packageRoot, "payload.txt"), "utf8")).toBe("old");
    await expect(updater.prepareUpdate(
      { ...input, targetVersion: "1.2.3" }
    )).rejects.toThrow("not newer");
    await expect(updater.prepareUpdate(
      { ...input, updateId: "../escape" }
    )).rejects.toThrow("identity");
  });

  it.each([
    { updateId: "a".repeat(15) },
    { updateId: "a".repeat(65) },
    { updateId: `${"a".repeat(16)}!` },
    { updateId: `!${"a".repeat(16)}` },
    { parentPid: 0 },
    { parentPid: -1 },
    { parentPid: 1.5 }
  ])("rejects an unsafe update identity %#", async (change) => {
    const { runtime } = fixture();
    await expect(updater.prepareUpdate({
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId: "bbbbbbb1-1234-1234-1234-123456789abc",
      ...change
    })).rejects.toThrow("identity");
  });

  it("keeps the active app running when staging or parent exit fails", async () => {
    const { runtime } = fixture();
    const input = {
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId: "22222222-1234-1234-1234-123456789abc"
    };
    await expect(updater.prepareUpdate(input, {
      runProcess: async () => { throw new Error("offline"); },
      launchApp: () => { throw new Error("must not launch"); }
    })).resolves.toBe("failed");
    await expect(updater.prepareUpdate(input, {
      runProcess: stage(runtime, "1.2.4"),
      waitForCommand: async () => "commit",
      waitForExit: async () => { throw new Error("still running"); },
      launchApp: () => { throw new Error("must not launch"); }
    })).resolves.toBe("failed");
    expect(fs.readFileSync(path.join(runtime.packageRoot, "payload.txt"), "utf8")).toBe("old");
  });

  it("launches the detached app with exact args and a safe environment", async () => {
    const { root, runtime } = fixture();
    const result = path.join(root, "launched.json");
    fs.writeFileSync(
      runtime.launcherScript,
      `require("node:fs").writeFileSync(${JSON.stringify(result)}, JSON.stringify({` +
        "args: process.argv.slice(2), secret: process.env.PULSETRAY_TEST_SECRET || null }));"
    );
    runtime.nodeExecPath = process.execPath;
    process.env.PULSETRAY_TEST_SECRET = "hidden";
    updater.launch(runtime, ["--hidden", "--update-result=success"]);
    await waitUntil(() => fs.existsSync(result));
    delete process.env.PULSETRAY_TEST_SECRET;
    expect(JSON.parse(fs.readFileSync(result, "utf8"))).toEqual({
      args: ["--hidden", "--update-result=success"],
      secret: null
    });
  });

  it("emits the exact preparation protocol and always removes staging", async () => {
    const { runtime, prefix } = fixture();
    const updateId = "ccccccc1-1234-1234-1234-123456789abc";
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(updater.prepareUpdate({
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId
    }, {
      runProcess: stage(runtime, "1.2.4"),
      waitForCommand: async () => "abort"
    })).resolves.toBe("aborted");
    expect(write).toHaveBeenCalledWith(`${JSON.stringify({ status: "prepared", updateId })}\n`);
    expect(fs.existsSync(path.join(prefix, `.pulsetray-stage-${updateId}`))).toBe(false);
    write.mockClear();
    await expect(updater.prepareUpdate({
      runtime,
      currentVersion: "1.2.3",
      targetVersion: "1.2.4",
      parentPid: 42,
      updateId
    }, {
      runProcess: async () => { throw new Error("offline"); }
    })).resolves.toBe("failed");
    expect(write).toHaveBeenCalledWith(`${JSON.stringify({ status: "failed", updateId })}\n`);
    write.mockRestore();
  });
});
