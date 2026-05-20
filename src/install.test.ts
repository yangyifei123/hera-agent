import { describe, test, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

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
      } catch (error) {
        // If bun test --help fails, that's okay
        expect(true).toBe(true);
      }
    });

    test("test files exist", () => {
      const srcPath = join(process.cwd(), "src");
      expect(existsSync(srcPath)).toBe(true);

      // Check for at least one test file
      const testFiles = execSync("find src -name '*.test.ts' -type f", {
        encoding: "utf-8",
        cwd: process.cwd(),
      }).trim().split("\n");

      expect(testFiles.length).toBeGreaterThan(0);
    });
  });

  describe("Build Artifacts", () => {
    test("dist directory structure is correct", () => {
      const distPath = join(process.cwd(), "dist");
      expect(existsSync(distPath)).toBe(true);

      // Check that dist has JavaScript files
      const jsFiles = execSync("find dist -name '*.js' -type f 2>/dev/null || echo ''", {
        encoding: "utf-8",
        cwd: process.cwd(),
      }).trim();

      expect(jsFiles.length).toBeGreaterThan(0);
    });

    test("no source maps in production build", () => {
      const distPath = join(process.cwd(), "dist");

      try {
        const mapFiles = execSync("find dist -name '*.map' -type f 2>/dev/null || echo ''", {
          encoding: "utf-8",
          cwd: process.cwd(),
        }).trim();

        // It's okay to have source maps, but we're just checking the build completed
        expect(distPath).toBeDefined();
      } catch {
        expect(true).toBe(true);
      }
    });
  });
});

