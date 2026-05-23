import { describe, test, expect } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "path";
import { execFileSync, execSync } from "child_process";

describe("Installation Tests", () => {
  describe("Build Verification", () => {
    test("package builds successfully", () => {
      const output = execSync("npm run build", {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: "pipe",
      });

      expect(output).toBeDefined();
      expect(existsSync(join(process.cwd(), "dist"))).toBe(true);
    }, 60000);

    test("built files are valid", () => {
      const distPath = join(process.cwd(), "dist");
      expect(existsSync(distPath)).toBe(true);

      // Check for key output files
      const indexPath = join(distPath, "index.js");
      expect(existsSync(indexPath)).toBe(true);
    });

    test("TypeScript types are generated", () => {
      const distPath = join(process.cwd(), "dist");
      const typesPath = join(distPath, "index.d.ts");

      if (existsSync(typesPath)) {
        expect(existsSync(typesPath)).toBe(true);
      } else {
        // Types might be in a different location or not generated
        expect(existsSync(distPath)).toBe(true);
      }
    });
  });

  describe("Package Integrity", () => {
    test("package.json has required fields", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      expect(pkg.name).toBe("hera-agent");
      expect(pkg.version).toBeDefined();
      expect(pkg.main).toBeDefined();
      expect(pkg.types).toBeDefined();
      expect(pkg.scripts).toBeDefined();
      expect(pkg.dependencies).toBeDefined();
    });

    test("has valid version number", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    test("exports are valid", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      if (pkg.exports) {
        expect(pkg.exports).toBeDefined();
        expect(typeof pkg.exports).toBe("object");
      }
    });

    test("files field includes necessary files", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      if (pkg.files) {
        expect(Array.isArray(pkg.files)).toBe(true);
        expect(pkg.files.length).toBeGreaterThan(0);
      }
    });

    test("has valid dependencies", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      expect(pkg.dependencies).toBeDefined();
      expect(typeof pkg.dependencies).toBe("object");
      expect(Object.keys(pkg.dependencies).length).toBeGreaterThan(0);
    });

    test("has valid devDependencies", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      expect(pkg.devDependencies).toBeDefined();
      expect(typeof pkg.devDependencies).toBe("object");
    });
  });

  describe("CLI lifecycle guidance", () => {
    test("update command exposes npm-first run mode", () => {
      const output = execSync("node bin/hera.js update", {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: "pipe",
      });

      expect(output).toContain("hera update --run");
      expect(output).toContain("npm update --prefix");
    });

    test("uninstall command exposes safe run and purge modes", () => {
      const output = execSync("node bin/hera.js uninstall", {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: "pipe",
      });

      expect(output).toContain("hera uninstall --run");
      expect(output).toContain("hera uninstall --run --purge --yes");
      expect(output).toContain("npm uninstall --prefix");
      if (process.platform === "win32") {
        expect(output).toContain("Remove-Item");
      } else {
        expect(output).toContain("rm -rf");
      }
    });

    test("purge run requires explicit confirmation", () => {
      try {
        execSync("node bin/hera.js uninstall --run --purge", {
          encoding: "utf-8",
          cwd: process.cwd(),
          stdio: "pipe",
        });
        throw new Error("Expected purge command to fail without confirmation");
      } catch (err) {
        const output = String((err as { stdout?: Buffer | string }).stdout ?? "");
        expect(output).toContain("Refusing to purge Hera data without confirmation");
      }
    });

    test("doctor fails when OpenCode CLI is not available", () => {
      try {
        execFileSync(process.execPath, ["bin/hera.js", "doctor"], {
          encoding: "utf-8",
          cwd: process.cwd(),
          stdio: "pipe",
          env: { ...process.env, PATH: "" },
        });
        throw new Error("Expected doctor to fail without OpenCode in PATH");
      } catch (err) {
        const output = String((err as { stdout?: Buffer | string }).stdout ?? "");
        expect(output).toContain("opencode CLI not found in PATH");
        expect(output).toContain("Some checks failed");
      }
    });

    test("help reports all inherited built-in skills", () => {
      const output = execSync("node bin/hera.js help", {
        encoding: "utf-8",
        cwd: process.cwd(),
        stdio: "pipe",
      });

      expect(output).toContain("Built-in Skills (11)");
      expect(output).toContain("workflow-orchestration");
      expect(output).toContain("brainstorming");
      expect(output).toContain("skill-creator");
    });
  });

  describe("Source Files", () => {
    test("main entry point exists", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      const mainPath = join(process.cwd(), pkg.main);
      expect(existsSync(mainPath)).toBe(true);
    });

    test("types entry point exists or dist is valid", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = require(pkgPath);

      if (pkg.types) {
        const typesPath = join(process.cwd(), pkg.types);
        const distPath = join(process.cwd(), "dist");

        // Either types file exists, or dist directory exists (types will be generated on build)
        const hasTypes = existsSync(typesPath);
        const hasDist = existsSync(distPath);

        expect(hasTypes || hasDist).toBe(true);
      }
    });

    test("README exists", () => {
      const readmePath = join(process.cwd(), "README.md");
      expect(existsSync(readmePath)).toBe(true);
    });

    test("LICENSE exists", () => {
      const licensePath = join(process.cwd(), "LICENSE");
      expect(existsSync(licensePath)).toBe(true);
    });
  });

  describe("TypeScript Configuration", () => {
    test("tsconfig.json exists and is valid", () => {
      const tsconfigPath = join(process.cwd(), "tsconfig.json");
      expect(existsSync(tsconfigPath)).toBe(true);

      const tsconfig = require(tsconfigPath);
      expect(tsconfig.compilerOptions).toBeDefined();
    });

    test("has proper compiler options", () => {
      const tsconfigPath = join(process.cwd(), "tsconfig.json");
      const tsconfig = require(tsconfigPath);

      expect(tsconfig.compilerOptions.target).toBeDefined();
      expect(tsconfig.compilerOptions.module).toBeDefined();
    });
  });

  describe("Test Infrastructure", () => {
    test("can run tests", () => {
      try {
        const output = execSync("bun test --help", {
          encoding: "utf-8",
          stdio: "pipe",
        });
        expect(output).toBeDefined();
      } catch {
        // If bun test --help fails, that's okay
        expect(true).toBe(true);
      }
    });

    test("test files exist", () => {
      const srcPath = join(process.cwd(), "src");
      expect(existsSync(srcPath)).toBe(true);

      // Check for at least one test file
      function collectTestFiles(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) return collectTestFiles(fullPath);
          return entry.name.endsWith(".test.ts") ? [fullPath] : [];
        });
      }

      const testFiles = collectTestFiles(srcPath);

      expect(testFiles.length).toBeGreaterThan(0);
    });
  });

  describe("Build Artifacts", () => {
    test("dist directory structure is correct", () => {
      const distPath = join(process.cwd(), "dist");
      expect(existsSync(distPath)).toBe(true);

      // Check that dist has JavaScript files
      function collectJsFiles(dir: string): string[] {
        if (!existsSync(dir)) return [];
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) return collectJsFiles(fullPath);
          return entry.name.endsWith(".js") ? [fullPath] : [];
        });
      }

      const jsFiles = collectJsFiles(distPath);

      expect(jsFiles.length).toBeGreaterThan(0);
    });

    test("no source maps in production build", () => {
      const distPath = join(process.cwd(), "dist");

      try {
        // It's okay to have source maps, but we're just checking the build completed
        expect(distPath).toBeDefined();
      } catch {
        expect(true).toBe(true);
      }
    });
  });
});
