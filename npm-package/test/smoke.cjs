#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} ${args.join(" ")} failed\n${output}\n${errors}`));
    });
  });
}

async function waitFor(file) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("installed launcher did not start the portable app");
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("Local npm launcher smoke is exercised on macOS; release CI covers Windows.");
    return;
  }
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulsetray-smoke-"));
  const packageRoot = path.resolve(__dirname, "..");
  const version = require(path.join(packageRoot, "package.json")).version;
  const asset = `iTransform-Pulse-${version}-mac-${process.arch}.zip`;
  const release = path.join(temporary, "release");
  const npmCache = path.join(temporary, "npm-cache");
  const payload = path.join(temporary, "payload", "iTransform Pulse.app", "Contents", "MacOS");
  const prefix = path.join(temporary, "prefix");
  const marker = path.join(temporary, "started");
  await fs.promises.mkdir(release, { recursive: true });
  await fs.promises.mkdir(payload, { recursive: true });
  const executable = path.join(payload, "iTransform Pulse");
  await fs.promises.writeFile(
    executable,
    "#!/bin/sh\nprintf started > \"${PULSETRAY_SMOKE_MARKER}\"\n",
    { mode: 0o755 }
  );
  run(
    "/usr/bin/ditto",
    [
      "-c",
      "-k",
      "--keepParent",
      path.join(temporary, "payload", "iTransform Pulse.app"),
      path.join(release, asset)
    ]
  );
  const bytes = await fs.promises.readFile(path.join(release, asset));
  const sum = crypto.createHash("sha256").update(bytes).digest("hex");
  await fs.promises.writeFile(path.join(release, "SHA256SUMS.txt"), `${sum}  ${asset}\n`);

  const server = http.createServer((request, response) => {
    const file = path.join(release, path.basename(request.url || ""));
    if (!fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temporary], {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: npmCache }
    }));
    const tarball = path.join(temporary, packed[0].filename);
    await runAsync("npm", ["install", "--global", "--prefix", prefix, tarball], {
      env: {
        ...process.env,
        npm_config_cache: npmCache,
        PULSETRAY_RELEASE_BASE_URL: `http://127.0.0.1:${port}`
      }
    });
    const launcher = path.join(prefix, "bin", "pulsetray");
    const versionOutput = run(launcher, ["--version"]);
    if (versionOutput !== `iTransform Pulse ${version}`) {
      throw new Error(`unexpected version: ${versionOutput}`);
    }
    run(launcher, ["--smoke"], { env: { ...process.env, PULSETRAY_SMOKE_MARKER: marker } });
    await waitFor(marker);
    console.log("Portable npm install and launcher smoke passed.");
  } finally {
    server.close();
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
