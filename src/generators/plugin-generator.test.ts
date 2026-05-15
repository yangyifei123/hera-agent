import { describe, it, expect, beforeEach } from "bun:test";
import { PluginGenerator } from "./plugin-generator.js";
import type { AgentDefinition } from "../types.js";
import { join } from "node:path";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

// === Test fixtures ===

function makeTestAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "test-coder",
    description: "A coding assistant for testing",
    mode: "all",
    prompt: "You are a test coding assistant. Write clean, tested code.",
    model: "anthropic/claude-sonnet-4-20250514",
    skills: ["caveman", "memory"],
    maxSteps: 30,
    createdAt: Date.now(),
    evolutionLog: [],
    ...overrides,
  };
}

describe("PluginGenerator", () => {
  let generator: PluginGenerator;
  let tmpDir: string;

  beforeEach(async () => {
    generator = new PluginGenerator();
    tmpDir = await mkdtemp(join(tmpdir(), "hera-plugin-test-"));
  });

  async function cleanup() {
    try { await rm(tmpDir, { recursive: true }); } catch {}
  }

  // ============================================================
  // Phase 1.1: package.json generation
  // ============================================================
  describe("generatePackageJson", () => {
    it("should produce package.json with correct name", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent);
      expect(pkg.name).toBe("test-coder");
      expect(pkg.version).toBe("1.0.0");
    });

    it("should include @opencode-ai/plugin as dependency (required at runtime)", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent);
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies!["@opencode-ai/plugin"]).toBeDefined();
    });

    it("should have correct main and exports for OpenCode to find", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent);
      expect(pkg.type).toBe("module");
      expect(pkg.main).toBe("./dist/index.js");
      expect(pkg.exports).toBeDefined();
      expect((pkg.exports as any)["."].import).toBe("./dist/index.js");
    });

    it("should have a build script that externalizes @opencode-ai/plugin", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent);
      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts!.build).toContain("bun build");
      expect(pkg.scripts!.build).toContain("--external @opencode-ai/plugin");
    });

    it("should have files array pointing to dist", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent);
      expect(pkg.files).toBeDefined();
      expect(pkg.files).toContain("dist");
    });
  });

  // ============================================================
  // Phase 1.2: src/index.ts generation — correct Plugin signature
  // ============================================================
  describe("generatePluginIndex", () => {
    it("should export default a Plugin function", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("export default");
      expect(code).toContain("Plugin");
    });

    it("should use the exact same config hook pattern as Hera", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("config");
      expect(code).toContain('input.agent = input.agent ?? {}');
      expect(code).toContain('input.agent["test-coder"]');
    });

    it("should set correct agent properties matching AgentConfig from SDK", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      // Properties appear as JSON keys in the generated code
      expect(code).toContain('"description"');
      expect(code).toContain('"mode"');
      expect(code).toContain('"prompt"');
      expect(code).toContain('"temperature"');
      expect(code).toContain('"permission"');
    });

    it("should bake the full prompt into the generated code", () => {
      const agent = makeTestAgent({
        prompt: "You are a test agent.\n\n## Skill: caveman\nSpeak like caveman."
      });
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("You are a test agent");
    });

    it("should not import SkillManager or any Hera internals", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).not.toContain("SkillManager");
      expect(code).not.toContain("MemoryStore");
      expect(code).not.toContain("AgentRegistry");
      expect(code).not.toContain("TeamManager");
    });

    it("should return empty tool map", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("tool:");
    });
  });

  // ============================================================
  // Phase 1.3: INSTALL.md generation
  // ============================================================
  describe("generateInstallMd", () => {
    it("should include bun add file:// command", () => {
      const agent = makeTestAgent();
      const md = generator.generateInstallMd(agent, "/path/to/test-coder");
      expect(md).toContain("bun add");
      expect(md).toContain("file://");
    });

    it("should include opencode.json plugin array step", () => {
      const agent = makeTestAgent();
      const md = generator.generateInstallMd(agent, "/path/to/test-coder");
      expect(md).toContain("opencode.json");
      expect(md).toContain("test-coder");
    });

    it("should include verification step", () => {
      const agent = makeTestAgent();
      const md = generator.generateInstallMd(agent, "/path/to/test-coder");
      expect(md).toContain("--agent");
    });
  });

  // ============================================================
  // Phase 1.4: Full package generation + disk write
  // ============================================================
  describe("generate (full package)", () => {
    it("should return a PluginPackage with all required files", () => {
      const agent = makeTestAgent();
      const pkg = generator.generate(agent);
      expect(pkg.name).toBe("test-coder");
      expect(pkg.version).toBe("1.0.0");
      expect(pkg.files.length).toBeGreaterThanOrEqual(3);
      const paths = pkg.files.map((f) => f.path);
      expect(paths).toContain("package.json");
      expect(paths).toContain("src/index.ts");
      expect(paths).toContain("INSTALL.md");
    });

    it("should produce valid JSON in package.json file", () => {
      const agent = makeTestAgent();
      const pkg = generator.generate(agent);
      const pkgFile = pkg.files.find((f) => f.path === "package.json");
      expect(pkgFile).toBeDefined();
      const parsed = JSON.parse(pkgFile!.content);
      expect(parsed.name).toBe("test-coder");
      expect(parsed.dependencies["@opencode-ai/plugin"]).toBeDefined();
    });

    it("should produce valid TypeScript in src/index.ts", () => {
      const agent = makeTestAgent();
      const pkg = generator.generate(agent);
      const indexFile = pkg.files.find((f) => f.path === "src/index.ts");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain("export default");
      expect(indexFile!.content).toContain("async");
    });
  });

  // ============================================================
  // Integration: generated code structural correctness
  // ============================================================
  describe("integration: generated plugin code structure", () => {
    it("should produce code that follows the Plugin contract", async () => {
      const agent = makeTestAgent({ name: "my-reviewer", mode: "subagent" });
      const pkg = generator.generate(agent);
      const outputDir = join(tmpDir, "my-reviewer");
      await generator.writeToDisk(pkg, outputDir);

      // Read back the generated src/index.ts
      const indexContent = await readFile(join(outputDir, "src/index.ts"), "utf-8");

      // Must contain the Plugin export signature
      expect(indexContent).toContain("export default");
      expect(indexContent).toContain("async (input)");

      // Must contain config hook that registers the agent
      expect(indexContent).toContain("async config(input)");
      expect(indexContent).toContain('input.agent = input.agent ?? {}');
      expect(indexContent).toContain('input.agent["my-reviewer"]');

      // Must contain the agent config with all required fields
      const agentConfig = JSON.parse(
        indexContent.match(/input\.agent\["my-reviewer"\]\s*=\s*(\{[\s\S]*?\});/)?.[1] ?? "{}"
      );
      expect(agentConfig.description).toBe("A coding assistant for testing");
      expect(agentConfig.mode).toBe("subagent");
      expect(agentConfig.prompt).toBeDefined();
      expect(agentConfig.temperature).toBeDefined();
      expect(agentConfig.maxSteps).toBeDefined();
      expect(agentConfig.permission).toBeDefined();
      expect(agentConfig.permission.edit).toBe("allow");
      expect(agentConfig.permission.bash).toBe("allow");

      // Must NOT import any Hera internals
      expect(indexContent).not.toContain("SkillManager");
      expect(indexContent).not.toContain("hera");
      expect(indexContent).not.toContain("memory-store");

      await cleanup();
    });

    it("should produce installable package.json that can be bun-added", async () => {
      const agent = makeTestAgent({ name: "install-test" });
      const pkg = generator.generate(agent);
      const outputDir = join(tmpDir, "install-test");
      await generator.writeToDisk(pkg, outputDir);

      // Read and verify the package.json
      const pkgContent = await readFile(join(outputDir, "package.json"), "utf-8");
      const parsed = JSON.parse(pkgContent);

      // Required for OpenCode to load the plugin
      expect(parsed.type).toBe("module");
      expect(parsed.main).toBe("./dist/index.js");
      expect(parsed.dependencies["@opencode-ai/plugin"]).toBeDefined();
      expect(parsed.scripts.build).toBeDefined();

      // Build script must externalize the plugin SDK
      expect(parsed.scripts.build).toContain("--external @opencode-ai/plugin");
      expect(parsed.scripts.build).toContain("--external @opencode-ai/sdk");

      await cleanup();
    });

    it("should handle agents with no model (model is optional)", async () => {
      const agent = makeTestAgent({ model: undefined });
      const code = generator.generatePluginIndex(agent);
      // model should NOT appear if undefined
      expect(code).not.toContain('"model"');
    });

    it("should handle agents with custom model", async () => {
      const agent = makeTestAgent({ model: "cherry/glm-5" });
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain('"model"');
      expect(code).toContain("cherry/glm-5");
    });

    it("should generate valid INSTALL.md with correct paths", async () => {
      const agent = makeTestAgent({ name: "path-test" });
      const pkg = generator.generate(agent);
      const outputDir = join(tmpDir, "path-test");
      await generator.writeToDisk(pkg, outputDir);

      const installMd = await readFile(join(outputDir, "INSTALL.md"), "utf-8");
      expect(installMd).toContain("path-test");
      expect(installMd).toContain("bun install");
      expect(installMd).toContain("bun run build");
      expect(installMd).toContain("opencode.json");

      await cleanup();
    });
  });

  describe("writeToDisk", () => {
    it("should create all files on disk with correct structure", async () => {
      const agent = makeTestAgent();
      const pkg = generator.generate(agent);
      const outputDir = join(tmpDir, "test-coder");
      await generator.writeToDisk(pkg, outputDir);

      const pkgPath = join(outputDir, "package.json");
      const pkgContent = await readFile(pkgPath, "utf-8");
      const parsed = JSON.parse(pkgContent);
      expect(parsed.name).toBe("test-coder");

      const indexPath = join(outputDir, "src/index.ts");
      const indexStat = await stat(indexPath);
      expect(indexStat.isFile()).toBe(true);

      const installPath = join(outputDir, "INSTALL.md");
      const installStat = await stat(installPath);
      expect(installStat.isFile()).toBe(true);

      await cleanup();
    });
  });
});
