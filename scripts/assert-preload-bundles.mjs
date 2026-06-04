import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const preloadDir = join(repoRoot, "out", "preload");
const chunksDir = join(preloadDir, "chunks");

const failures = [];

if (!existsSync(preloadDir)) {
  failures.push(`Missing preload output directory: ${preloadDir}`);
}

if (existsSync(chunksDir)) {
  failures.push(`Unexpected preload chunks directory: ${chunksDir}`);
}

const preloadEntries = existsSync(preloadDir)
  ? readdirSync(preloadDir).filter((entry) => {
      const entryPath = join(preloadDir, entry);
      return entry.endsWith(".cjs") && statSync(entryPath).isFile();
    })
  : [];

if (preloadEntries.length === 0) {
  failures.push("No preload entry bundles were generated.");
}

for (const entry of preloadEntries) {
  const entryPath = join(preloadDir, entry);
  const source = readFileSync(entryPath, "utf8");

  if (/require\(["']\.\.?\//.test(source)) {
    failures.push(`${entry} contains a relative require that sandboxed preload cannot load.`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `${[
      "Sandbox preload bundles must be standalone files.",
      ...failures,
      `Generated preload files: ${readdirSync(preloadDir).join(", ")}`,
    ].join("\n")}\n`,
  );
  process.exit(1);
}
