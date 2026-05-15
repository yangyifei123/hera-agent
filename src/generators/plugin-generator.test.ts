import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { PluginGenerator } from "./plugin-generator.js";
import type { AgentDefinition, SkillPackage, AgentCapability } from "../types.js";
import { join } from "node:path";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";

// --- Helpers ---

function makeAgentDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "test-agent",
    description: "A test agent for plugin generation",
    mode: "subagent",
    prompt: "You are a test agent.",
    skills: ["caveman", "init", "memory", "evolution"],
    createdAt: Date.now(),
    evolutionLog: [],
    ...overrides,
  };
}

function makeSkillPackage(overrides?: Partial<SkillPackage>): SkillPackage {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    trigger: { patterns: ["test"], keywords: ["test"] },
    dependencies: [],
    chains: [],
    files: [],
    config: {},
    scripts: [],
    prompt: "You have the test skill.",
    metadata: {},
    ...overrides,
  };
}

function makeCapabilities(overrides?: Partial<AgentCapability>[]): AgentCapability[] {
  return [
    { name: "memory", enabled: true },
    { name: "evolution", enabled: false },
    ...(overrides ?? []),
  ];
}

describe("PluginGenerator", () => {
  let gen: PluginGenerator;
  let tmpDir: string;

  beforeEach(async () => {
    gen = new PluginGenerator();
    tmpDir = join(process.env.TEMP || "/tmp", `hera-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("generate", () => {
    it("returns a PluginPackage with correct metadata", () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      expect(pkg.name).toBe("hera-agent-test-agent");
      expect(pkg.version).toBe("1.0.0");
      expect(pkg.description).toBe("A test agent for plugin generation");
      expect(pkg.main).toBe("./src/index.ts");
    });

    it("generates package.json file", () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      const packageJson = pkg.files.find((f) => f.path === "package.json");
      expect(packageJson).toBeDefined();
      const parsed = JSON.parse(packageJson!.content);
      expect(parsed.name).toBe("hera-agent-test-agent");
      expect(parsed.type).toBe("module");
      expect(parsed.main).toBe("./src/index.ts");
      expect(parsed.exports["."].import).toBe("./src/index.ts");
    });

    it("generates src/index.ts with plugin function", () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      const indexFile = pkg.files.find((f) => f.path === "src/index.ts");
      expect(indexFile).toBeDefined();
      expect(indexFile!.content).toContain('import type { Plugin } from "@opencode-ai/plugin"');
      expect(indexFile!.content).toContain("const AgentPlugin: Plugin");
      expect(indexFile!.content).toContain('configInput.agent["test-agent"]');
      expect(indexFile!.content).toContain("export default AgentPlugin");
    });

    it("generates src/index.ts with correct agent config", () => {
      const agent = makeAgentDef({ mode: "all", model: "test-model" });
      const pkg = gen.generate(agent, []);

      const indexFile = pkg.files.find((f) => f.path === "src/index.ts");
      expect(indexFile!.content).toContain('"mode": "all"');
      expect(indexFile!.content).toContain('"model": "test-model"');
    });

    it("generates agent.md with frontmatter and prompt", () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      const agentMd = pkg.files.find((f) => f.path === "agent.md");
      expect(agentMd).toBeDefined();
      expect(agentMd!.content).toContain("---");
      expect(agentMd!.content).toContain("name: test-agent");
      expect(agentMd!.content).toContain("description: A test agent for plugin generation");
      expect(agentMd!.content).toContain("mode: subagent");
      expect(agentMd!.content).toContain("You are a test agent.");
    });

    it("generates config/defaults.json", () => {
      const agent = makeAgentDef({ maxSteps: 50 });
      const pkg = gen.generate(agent, []);

      const defaults = pkg.files.find((f) => f.path === "config/defaults.json");
      expect(defaults).toBeDefined();
      const parsed = JSON.parse(defaults!.content);
      expect(parsed.agent.name).toBe("test-agent");
      expect(parsed.agent.mode).toBe("subagent");
      expect(parsed.agent.maxSteps).toBe(50);
      expect(parsed.skills).toEqual(["caveman", "init", "memory", "evolution"]);
    });

    it("generates skill files when skills provided", () => {
      const agent = makeAgentDef();
      const skills = [makeSkillPackage({ name: "my-skill" })];
      const pkg = gen.generate(agent, [], skills);

      const skillFile = pkg.files.find((f) => f.path === "skills/my-skill.json");
      expect(skillFile).toBeDefined();
      const parsed = JSON.parse(skillFile!.content);
      expect(parsed.name).toBe("my-skill");
      expect(parsed.version).toBe("1.0.0");
    });

    it("generates multiple skill files", () => {
      const agent = makeAgentDef();
      const skills = [
        makeSkillPackage({ name: "skill-a" }),
        makeSkillPackage({ name: "skill-b" }),
      ];
      const pkg = gen.generate(agent, [], skills);

      const skillFiles = pkg.files.filter((f) => f.path.startsWith("skills/"));
      expect(skillFiles).toHaveLength(2);
    });

    it("generates capabilities.md when enabled capabilities exist", () => {
      const agent = makeAgentDef();
      const caps = [{ name: "memory", enabled: true }];
      const pkg = gen.generate(agent, caps);

      const capFile = pkg.files.find((f) => f.path === "config/capabilities.md");
      expect(capFile).toBeDefined();
      expect(capFile!.content).toContain("memory");
    });

    it("does not generate capabilities.md when all disabled", () => {
      const agent = makeAgentDef();
      const caps = [{ name: "memory", enabled: false }];
      const pkg = gen.generate(agent, caps);

      const capFile = pkg.files.find((f) => f.path === "config/capabilities.md");
      expect(capFile).toBeUndefined();
    });

    it("includes at minimum 4 core files (package.json, index.ts, agent.md, defaults.json)", () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      const corePaths = ["package.json", "src/index.ts", "agent.md", "config/defaults.json"];
      for (const p of corePaths) {
        expect(pkg.files.some((f) => f.path === p)).toBe(true);
      }
    });

    it("handles agent with no description", () => {
      const agent = makeAgentDef({ description: "" });
      const pkg = gen.generate(agent, []);

      expect(pkg.description).toContain("test-agent");
    });

    it("handles agent with custom permission", () => {
      const agent = makeAgentDef({
        permission: { edit: "allow", bash: "deny", webfetch: "allow" },
      });
      const pkg = gen.generate(agent, []);

      const indexFile = pkg.files.find((f) => f.path === "src/index.ts");
      expect(indexFile!.content).toContain('"bash": "deny"');
    });
  });

  describe("writeToDisk", () => {
    it("writes all files to the output directory", async () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      await gen.writeToDisk(pkg, tmpDir);

      const packageJson = JSON.parse(
        await readFile(join(tmpDir, "package.json"), "utf-8")
      );
      expect(packageJson.name).toBe("hera-agent-test-agent");
    });

    it("writes index.ts to nested directory", async () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      await gen.writeToDisk(pkg, tmpDir);

      const content = await readFile(join(tmpDir, "src/index.ts"), "utf-8");
      expect(content).toContain("AgentPlugin");
    });

    it("writes agent.md", async () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      await gen.writeToDisk(pkg, tmpDir);

      const content = await readFile(join(tmpDir, "agent.md"), "utf-8");
      expect(content).toContain("name: test-agent");
    });

    it("writes skill files to skills/ subdirectory", async () => {
      const agent = makeAgentDef();
      const skills = [makeSkillPackage({ name: "disk-skill" })];
      const pkg = gen.generate(agent, [], skills);

      await gen.writeToDisk(pkg, tmpDir);

      const content = await readFile(join(tmpDir, "skills/disk-skill.json"), "utf-8");
      expect(content).toContain("disk-skill");
    });

    it("creates config directory and writes defaults.json", async () => {
      const agent = makeAgentDef();
      const pkg = gen.generate(agent, []);

      await gen.writeToDisk(pkg, tmpDir);

      const content = await readFile(join(tmpDir, "config/defaults.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.agent.name).toBe("test-agent");
    });
  });

  describe("install", () => {
    it("creates opencode.json with plugin entry if file does not exist", async () => {
      await gen.install("file:///path/to/plugin", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.plugin).toContain("file:///path/to/plugin");
    });

    it("adds plugin entry to existing opencode.json", async () => {
      // Create existing opencode.json
      const existing = { plugin: ["existing-plugin"] };
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify(existing, null, 2),
        "utf-8"
      );

      await gen.install("file:///new/plugin", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.plugin).toContain("existing-plugin");
      expect(parsed.plugin).toContain("file:///new/plugin");
    });

    it("does not add duplicate plugin entries", async () => {
      const existing = { plugin: ["file:///dup/plugin"] };
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify(existing, null, 2),
        "utf-8"
      );

      await gen.install("file:///dup/plugin", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      const matches = (parsed.plugin as string[]).filter(
        (p) => p === "file:///dup/plugin"
      );
      expect(matches).toHaveLength(1);
    });

    it("prepends file:// if missing from plugin path", async () => {
      await gen.install("/local/path/to/plugin", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.plugin).toContain("file:///local/path/to/plugin");
    });

    it("creates plugin array if opencode.json has no plugin key", async () => {
      const existing = { someOtherKey: true };
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify(existing, null, 2),
        "utf-8"
      );

      await gen.install("file:///new/plugin", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(Array.isArray(parsed.plugin)).toBe(true);
      expect(parsed.plugin).toContain("file:///new/plugin");
    });
  });

  describe("uninstall", () => {
    it("removes matching plugin entry from opencode.json", async () => {
      const existing = {
        plugin: ["hera-agent-test-agent", "other-plugin"],
      };
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify(existing, null, 2),
        "utf-8"
      );

      await gen.uninstall("hera-agent-test-agent", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.plugin).not.toContain("hera-agent-test-agent");
      expect(parsed.plugin).toContain("other-plugin");
    });

    it("handles missing opencode.json gracefully", async () => {
      // Should not throw
      await gen.uninstall("nonexistent", tmpDir);
    });

    it("handles opencode.json without plugin array gracefully", async () => {
      const existing = { someKey: "value" };
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify(existing, null, 2),
        "utf-8"
      );

      // Should not throw
      await gen.uninstall("anything", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      // Config should remain unchanged
      expect(parsed.someKey).toBe("value");
    });

    it("does nothing if no matching entries found", async () => {
      const existing = { plugin: ["other-plugin"] };
      await writeFile(
        join(tmpDir, "opencode.json"),
        JSON.stringify(existing, null, 2),
        "utf-8"
      );

      await gen.uninstall("nonexistent-plugin", tmpDir);

      const content = await readFile(join(tmpDir, "opencode.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.plugin).toEqual(["other-plugin"]);
    });
  });
});
