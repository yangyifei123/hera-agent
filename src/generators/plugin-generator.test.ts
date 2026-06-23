import { describe, it, expect, beforeEach } from "bun:test";
import { PluginGenerator } from "./plugin-generator.js";
import type { AgentDefinition, SkillDefinition } from "../types.js";
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
    try {
      await rm(tmpDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
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
      expect(code).toContain("input.agent = input.agent ?? {}");
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
        prompt: "You are a test agent.\n\n## Skill: caveman\nSpeak like caveman.",
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
      expect(indexContent).toContain("input.agent = input.agent ?? {}");
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

      // Must NOT import any Hera internals (the string "hera" may legitimately
      // appear inside the embedded skill prompts, e.g. "hera_remember" — what
      // matters is no `import` from hera modules or use of internal classes)
      expect(indexContent).not.toContain("SkillManager");
      expect(indexContent).not.toContain("MemoryStore");
      expect(indexContent).not.toContain("AgentRegistry");
      expect(indexContent).not.toContain("TeamManager");
      expect(indexContent).not.toMatch(/from\s+["'][^"']*hera[^"']*["']/);

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

  // ============================================================
  // Phase P0: Full prompt assembly — skills + evolution embedding
  // (parity with md mode via buildAgentPrompt)
  // ============================================================
  describe("full prompt assembly (P0)", () => {
    it("should embed built-in caveman skill content into generated prompt", () => {
      const agent = makeTestAgent({ prompt: "BASE_PROMPT_MARKER" });
      const code = generator.generatePluginIndex(agent);
      // The generated agent prompt must contain caveman skill prompt content
      expect(code).toContain("Caveman Mode");
      expect(code).toContain("BASE_PROMPT_MARKER");
    });

    it("should embed built-in memory skill content into generated prompt", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("Autonomous Knowledge Persistence");
    });

    it("should embed built-in init skill content into generated prompt", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      // Init skill prompt mentions context gathering
      expect(code.toLowerCase()).toContain("init");
    });

    it("should embed built-in evolution skill content into generated prompt", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code.toLowerCase()).toContain("evolution");
    });

    it("should embed additional user skills when provided", () => {
      const agent = makeTestAgent({ skills: ["caveman", "memory", "my-custom-skill"] });
      const userSkill: SkillDefinition = {
        name: "my-custom-skill",
        description: "test",
        trigger: "test",
        prompt: "CUSTOM_SKILL_BODY_MARKER",
        category: "user",
      };
      const code = generator.generatePluginIndex(agent, [userSkill]);
      expect(code).toContain("CUSTOM_SKILL_BODY_MARKER");
      expect(code).toContain("my-custom-skill");
    });

    it("should bake evolution log directives into generated prompt", () => {
      const agent = makeTestAgent({
        evolutionLog: [
          {
            timestamp: 1700000000000,
            trigger: "test",
            observation: "test",
            directive: "EVO_DIRECTIVE_ONE",
            rolledBack: false,
          },
          {
            timestamp: 1700000001000,
            trigger: "test",
            observation: "test",
            directive: "EVO_DIRECTIVE_TWO",
            rolledBack: false,
          },
        ],
      });
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("Evolved Directives");
      expect(code).toContain("EVO_DIRECTIVE_ONE");
      expect(code).toContain("EVO_DIRECTIVE_TWO");
    });

    it("should NOT embed evolution directives that are rolledBack", () => {
      const agent = makeTestAgent({
        evolutionLog: [
          {
            timestamp: 1700000000000,
            trigger: "test",
            observation: "test",
            directive: "ACTIVE_DIRECTIVE",
            rolledBack: false,
          },
          {
            timestamp: 1700000001000,
            trigger: "test",
            observation: "test",
            directive: "ROLLED_BACK_DIRECTIVE",
            rolledBack: true,
          },
        ],
      });
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("ACTIVE_DIRECTIVE");
      expect(code).not.toContain("ROLLED_BACK_DIRECTIVE");
    });

    it("generate() should accept resolvedSkills and embed them", () => {
      const agent = makeTestAgent({ skills: ["caveman", "extra-skill"] });
      const extraSkill: SkillDefinition = {
        name: "extra-skill",
        description: "test",
        trigger: "test",
        prompt: "EXTRA_SKILL_BODY",
        category: "user",
      };
      const pkg = generator.generate(agent, [extraSkill]);
      const indexFile = pkg.files.find((f) => f.path === "src/index.ts");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain("EXTRA_SKILL_BODY");
    });

    it("should include tsconfig.json so the generated plugin can be built standalone", () => {
      const agent = makeTestAgent();
      const pkg = generator.generate(agent);
      const tsconfigFile = pkg.files.find((f) => f.path === "tsconfig.json");
      expect(tsconfigFile).toBeDefined();
      // Must be valid JSON
      const parsed = JSON.parse(tsconfigFile!.content);
      expect(parsed.compilerOptions).toBeDefined();
    });
  });

  // ============================================================
  // Phase P0-2: Memory tools injected into generated plugin
  // ============================================================
  describe("memory tools injection (P0-2)", () => {
    it("should register hera_remember tool in generated plugin", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("hera_remember");
      // Must use tool() factory from @opencode-ai/plugin
      expect(code).toContain("import { tool }");
    });

    it("should register hera_recall tool in generated plugin", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("hera_recall");
    });

    it("tool map must NOT be empty `{}` — at least memory tools registered", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).not.toMatch(/tool:\s*\{\s*\}/);
    });

    it("should resolve memory dir via env (HERA_DIR) or default user-home path", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      // Path resolution must consult HERA_DIR / USERPROFILE / HOME so the
      // generated plugin shares the same memory dir as Hera itself.
      expect(code).toContain("HERA_DIR");
      expect(code).toMatch(/USERPROFILE|HOME/);
      expect(code).toContain("hera-data");
      expect(code).toContain("memory");
    });

    it("memory tool implementation should be inline (no hera-agent runtime dep)", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      // Must NOT import MemoryStore from hera-agent
      expect(code).not.toMatch(/from\s+["'][^"']*hera-agent[^"']*["']/);
      expect(code).not.toContain("MemoryStore");
      // Must use node:fs/promises directly
      expect(code).toMatch(/from\s+["']node:fs\/promises["']/);
    });

    it("hera_remember tool should accept content and category args", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("content");
      expect(code).toContain("category");
    });

    it("should declare and use the same schema alias in generated memory tools", () => {
      const agent = makeTestAgent();
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain("const z = tool.schema;");
      expect(code).not.toContain("const _z = tool.schema");
      expect(code).toMatch(/content: z\.string\(/);
      expect(code).toMatch(/category: z\.enum\(/);
      expect(code).toMatch(/limit: z\.number\(\)\.optional\(\)/);
    });
  });

  // ============================================================
  // Phase P0-4: installWithBuild — runs bun install/build/add
  // ============================================================
  describe("installWithBuild (P0-4)", () => {
    it("should run bun install, bun run build, bun add in the right cwds", async () => {
      const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
      const runner = async (cmd: string, args: string[], cwd: string) => {
        calls.push({ cmd, args, cwd });
        return { ok: true, stdout: "", stderr: "" };
      };
      const gen = new PluginGenerator(runner);
      const pluginDir = join(tmpDir, "plugins", "my-agent");
      const configRoot = join(tmpDir, "opencode");

      const result = await gen.installWithBuild(pluginDir, configRoot);

      expect(result.ok).toBe(true);
      expect(calls.length).toBe(3);

      // Step 1: bun install in pluginDir
      expect(calls[0].cmd).toBe("bun");
      expect(calls[0].args).toContain("install");
      expect(calls[0].cwd).toBe(pluginDir);

      // Step 2: bun run build in pluginDir
      expect(calls[1].cmd).toBe("bun");
      expect(calls[1].args).toEqual(["run", "build"]);
      expect(calls[1].cwd).toBe(pluginDir);

      // Step 3: bun add file://pluginDir in configRoot
      expect(calls[2].cmd).toBe("bun");
      expect(calls[2].args[0]).toBe("add");
      expect(calls[2].args[1]).toContain("file://");
      expect(calls[2].args[1]).toContain("my-agent");
      expect(calls[2].cwd).toBe(configRoot);
    });

    it("should stop and report failure if any step fails", async () => {
      const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
      const runner = async (cmd: string, args: string[], cwd: string) => {
        calls.push({ cmd, args, cwd });
        if (args.includes("build")) {
          return { ok: false, stdout: "", stderr: "type error in src/index.ts" };
        }
        return { ok: true, stdout: "", stderr: "" };
      };
      const gen = new PluginGenerator(runner);
      const result = await gen.installWithBuild(join(tmpDir, "p"), join(tmpDir, "c"));

      expect(result.ok).toBe(false);
      // install ran, build ran (failed), add did NOT run
      expect(calls.length).toBe(2);
      const buildStep = result.steps.find((s) => s.name === "build");
      expect(buildStep?.ok).toBe(false);
      expect(buildStep?.stderr).toContain("type error");
    });

    it("should return steps array with stdout/stderr for each step", async () => {
      const runner = async () => ({ ok: true, stdout: "ok", stderr: "" });
      const gen = new PluginGenerator(runner);
      const result = await gen.installWithBuild(join(tmpDir, "p"), join(tmpDir, "c"));
      expect(result.steps.length).toBe(3);
      expect(result.steps[0].name).toBe("install");
      expect(result.steps[1].name).toBe("build");
      expect(result.steps[2].name).toBe("add");
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
