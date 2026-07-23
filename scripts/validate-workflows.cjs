const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const directory = path.resolve(".github/workflows");
const files = fs.readdirSync(directory).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
if (!files.length) throw new Error("No GitHub Actions workflows found.");

for (const file of files) {
  const document = YAML.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  if (!document || !document.name || !document.jobs || Object.keys(document.jobs).length === 0) {
    throw new Error(`${file}: missing name or jobs`);
  }
}

const release = YAML.parse(fs.readFileSync(path.join(directory, "release.yml"), "utf8"));
const trigger = release.on;
if (!trigger?.push?.tags?.includes("v*.*.*") || !trigger.workflow_dispatch) {
  throw new Error("release.yml must support semver tags and manual dispatch");
}
for (const job of ["build-macos", "build-windows", "publish-release", "publish-npm", "smoke-npm"]) {
  if (!release.jobs[job]) throw new Error(`release.yml missing ${job}`);
}
console.log(`Validated ${files.length} workflow files.`);
