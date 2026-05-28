import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const roots = ["src", "tests", "scripts", "electron.vite.config.ts", "vitest.config.ts"];
const supportedExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set(["node_modules", "out", "dist", "coverage"]);

const isSupportedFile = (path) => supportedExtensions.has(extname(path));

const collectFiles = async (path) => {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);

  if (entries.length === 0 && isSupportedFile(path)) {
    return [path];
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = join(path, entry.name);

      if (entry.isDirectory()) {
        return ignoredDirectories.has(entry.name) ? [] : collectFiles(nextPath);
      }

      return entry.isFile() && isSupportedFile(nextPath) ? [nextPath] : [];
    }),
  );

  return nested.flat();
};

const sourceKindFor = (filePath) =>
  filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const forbiddenKindName = (node) => {
  if (ts.isFunctionDeclaration(node)) return "function declaration";
  if (ts.isFunctionExpression(node)) return "function expression";
  if (ts.isMethodDeclaration(node)) return "method declaration";
  if (ts.isGetAccessorDeclaration(node)) return "getter declaration";
  if (ts.isSetAccessorDeclaration(node)) return "setter declaration";
  return null;
};

const inspectFile = async (filePath) => {
  const source = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceKindFor(filePath),
  );
  const violations = [];

  const visit = (node) => {
    const kind = forbiddenKindName(node);

    if (kind !== null) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        filePath,
        line: position.line + 1,
        column: position.character + 1,
        kind,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const run = async () => {
  const files = (await Promise.all(roots.map((root) => collectFiles(root)))).flat();
  const violations = (await Promise.all(files.map((file) => inspectFile(file)))).flat();

  if (violations.length === 0) {
    return;
  }

  const message = violations
    .map((violation) => {
      const path = relative(process.cwd(), violation.filePath);
      return `${path}:${violation.line}:${violation.column} uses ${violation.kind}; use an arrow function instead.`;
    })
    .join("\n");

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

await run();
