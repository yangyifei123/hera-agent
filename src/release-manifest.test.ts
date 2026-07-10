import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Reads the actual package.json shipped at the repo root and verifies that
// every JS entry point referenced by `exports` is actually covered by the
// `files` allow-list, so npm packs a tarball that isn't missing runtime code
// (e.g. dist/engine/index.js for the "hera-agent/engine" subpath export).

const pkgPath = join(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
  exports: Record<string, Record<string, string>>;
  files: string[];
};

function isCoveredByFiles(path: string, files: string[]): boolean {
  // normalize leading "./"
  const normalized = path.replace(/^\.\//, "");

  return files.some((pattern) => {
    if (pattern === normalized) return true;

    // Support simple dist/**/*.ext-style globs used in this package.json.
    if (pattern.includes("**")) {
      const escaped = pattern
        .split("**")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : `\\${c}`)))
        .join(".*");
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(normalized);
    }

    return false;
  });
}

describe("release manifest (package.json files vs exports)", () => {
  test("every exports .js entry point is covered by the files allow-list", () => {
    const uncovered: string[] = [];

    for (const [subpath, target] of Object.entries(pkg.exports)) {
      for (const [condition, filePath] of Object.entries(target)) {
        if (typeof filePath !== "string" || !filePath.endsWith(".js")) continue;
        if (!isCoveredByFiles(filePath, pkg.files)) {
          uncovered.push(`exports["${subpath}"].${condition} -> ${filePath}`);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });

  test("files allow-list explicitly includes dist/engine/index.js", () => {
    expect(pkg.files).toContain("dist/engine/index.js");
  });
});
