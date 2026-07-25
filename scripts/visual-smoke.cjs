const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const output = fs.mkdtempSync(path.join(os.tmpdir(), "itransform-pulse-ui-"));
const rendererRoot = path.join(process.cwd(), "dist", "visual-smoke");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let rendererUrl = "";

function createRendererServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if (pathname === "/harness.html") {
      const width = Number(url.searchParams.get("width")) || 500;
      const height = Number(url.searchParams.get("height")) || 700;
      const surface = url.searchParams.get("surface") === "question" ? "question" : "panel";
      const requestedPreview = url.searchParams.get("preview");
      const preview = requestedPreview || (surface === "question" ? "question" : "configured");
      const journey = url.searchParams.get("journey") || "";
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff}
iframe{display:block;border:0;width:${width}px;height:${height}px}
</style></head><body>
<iframe src="/?surface=${surface}&preview=${preview}&journey=${journey}"></iframe>
<script>
addEventListener("message",function(event){
  if(event.origin!==location.origin||event.data?.kind!=="visual-smoke-result")return;
  var output=document.createElement("script");
  output.id="visual-smoke-result";
  output.type="application/json";
  output.textContent=JSON.stringify(event.data.result);
  document.body.append(output);
});
</script></body></html>`);
      return;
    }
    const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const absolutePath = path.resolve(rendererRoot, relativePath);
    if (!absolutePath.startsWith(`${rendererRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const type = absolutePath.endsWith(".js")
      ? "text/javascript"
      : absolutePath.endsWith(".css")
        ? "text/css"
        : absolutePath.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
    fs.readFile(absolutePath, (error, contents) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(contents);
    });
  });
}

function runChrome(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stopTimer;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes('id="visual-smoke-result"') && !stopTimer) {
        stopTimer = setTimeout(() => child.kill("SIGTERM"), 250);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const timeout = setTimeout(() => child.kill("SIGTERM"), 15_000);
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(stopTimer);
      if (code === 0 || (signal === "SIGTERM" && stdout.includes("visual-smoke-result"))) {
        resolve(stdout);
      }
      else reject(new Error(`Chrome exited with ${code}: ${stderr}`));
    });
  });
}

async function capture(
  name,
  width,
  height,
  surface = "panel",
  journey = "",
  preview = ""
) {
  const screenshot = path.join(output, `${name}.png`);
  const profile = fs.mkdtempSync(path.join(output, `${name}-profile-`));
  const html = await runChrome([
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--hide-scrollbars",
    "--no-default-browser-check",
    "--no-first-run",
    "--force-device-scale-factor=1",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--virtual-time-budget=12000",
    "--dump-dom",
    `--screenshot=${screenshot}`,
    `${rendererUrl}/harness.html?width=${width}&height=${height}&surface=${surface}` +
      `&journey=${journey}&preview=${preview}`
  ]);
  const match = html.match(
    /<script id="visual-smoke-result" type="application\/json">([^<]+)<\/script>/
  );
  if (!match) throw new Error(`${name} did not report visual metrics.`);
  const metrics = JSON.parse(
    match[1]
      .replaceAll("&quot;", "\"")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
  );
  if (metrics.journeyError) {
    throw new Error(`${name} journey failed: ${metrics.journeyError}`);
  }
  if (metrics.scrollWidth > metrics.innerWidth || metrics.bodyScrollWidth > metrics.innerWidth) {
    throw new Error(`${name} has horizontal overflow: ${JSON.stringify(metrics)}`);
  }
  if (
    name.startsWith("wizard-")
    && (metrics.scrollHeight > metrics.innerHeight || metrics.bodyScrollHeight > metrics.innerHeight)
  ) {
    throw new Error(`${name} has vertical overflow: ${JSON.stringify(metrics)}`);
  }
  if (metrics.smallControls.length > 0) {
    throw new Error(`${name} has controls below 44px: ${JSON.stringify(metrics.smallControls)}`);
  }
  return { name, screenshot, ...metrics };
}

(async () => {
  if (!fs.existsSync(chromePath)) throw new Error("Google Chrome is required for visual smoke.");
  const server = createRendererServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Visual server unavailable.");
    rendererUrl = `http://127.0.0.1:${address.port}`;
    const results = [];
    results.push(await capture("panel-320x620", 320, 620));
    results.push(await capture("panel-440x620", 440, 620));
    results.push(await capture("onboarding-440x620", 440, 620, "panel", "", "token"));
    results.push(await capture("wizard-method-760x820", 760, 820, "panel", "method"));
    results.push(await capture("wizard-evidence-760x820", 760, 820, "panel", "evidence"));
    results.push(await capture("wizard-guidance-760x820", 760, 820, "panel", "guidance"));
    results.push(await capture("wizard-review-760x820", 760, 820, "panel", "review"));
    results.push(await capture("wizard-success-760x820", 760, 820, "panel", "success"));
    results.push(await capture("received-760x820", 760, 820, "panel", "received"));
    results.push(await capture("settings-520x720", 520, 720, "panel", "settings"));
    results.push(await capture("question-660x720", 660, 720, "question"));
    process.stdout.write(`${JSON.stringify({ output, results }, null, 2)}\n`);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    process.exitCode = 1;
  }
})();
