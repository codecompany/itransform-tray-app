import { promises as fs } from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve("src");
const forbidden = /(?:from\s+|import\s*\()\s*["'](?:node:|electron|fs(?:\/|["'])|path(?:\/|["']))/;
const failures = [];

async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.tsx")) {
      const source = await fs.readFile(file, "utf8");
      if (forbidden.test(source)) failures.push(path.relative(process.cwd(), file));
    }
  }
}

await walk(sourceRoot);
if (failures.length) {
  console.error(`Renderer imports Node/Electron modules: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Renderer boundary validated.");
