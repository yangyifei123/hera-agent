import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamPluginGenerator } from "./team-plugin-generator.js";
import type { TeamDefinition, AgentDefinition } from "../types.js";

function makeTeam(overrides?: Partial<TeamDefinition>): TeamDefinition {
  return {
    name: "dev-team",
    description: "Full dev team",
    coordination: "sequential",
    members: [
      { agentName: "architect", role: "architect", subscriptions: [], backendType: "in-process" },
      { agentName: "senior-dev", role: "developer", subscriptions: [], backendType: "in-process" },
      { agentName: "qa-engineer", role: "tester", subscriptions: [], backendType: "in-process" },
    ],
    ...overrides,
  };
}

function makeAgent(name: string, overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name,
    description: `${name} agent`,
    mode: "subagent",
    prompt: `You are ${name}.`,
    skills: ["caveman", "memory"],
    maxSteps: 30,
    createdAt: Date.now(),
    evolutionLog: [],
    ...overrides,
  };
}

describe("TeamPluginGenerator", () => {
  let gen: TeamPluginGenerator;
  let tmp: string;

  beforeEach(async () => {
    gen = new TeamPluginGenerator();
    tmp = await mkdtemp(join(tmpdir(), "hera-team-plugin-test-"));
  });

  describe("generate (full package)", () => {
    it("produces a PluginPackage with all required files", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const pkg = gen.generate(team, members, []);
      expect(pkg.name).toContain("dev-team");
      const paths = pkg.files.map((f) => f.path);
      expect(paths).toContain("package.json");
      expect(paths).toContain("tsconfig.json");
      expect(paths).toContain("src/index.ts");
      expect(paths).toContain("INSTALL.md");
    });

    it("plugin name is suffixed with -team to disambiguate from agent plugins", () => {
      const team = makeTeam({ name: "review-squad" });
      const members = team.members.map((m) => makeAgent(m.agentName));
      const pkg = gen.generate(team, members, []);
      const pkgFile = pkg.files.find((f) => f.path === "package.json");
      const parsed = JSON.parse(pkgFile!.content);
      expect(parsed.name).toMatch(/team/);
      expect(parsed.name).toContain("review-squad");
    });
  });

  describe("generatePluginIndex (team)", () => {
    it("registers every team member agent in the config hook", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      expect(code).toContain('input.agent["architect"]');
      expect(code).toContain('input.agent["senior-dev"]');
      expect(code).toContain('input.agent["qa-engineer"]');
    });

    it("injects team context into every member's prompt", () => {
      const team = makeTeam({ name: "alpha-team", coordination: "parallel" });
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      // Each agent prompt should know it is part of the team
      expect(code).toContain("alpha-team");
      expect(code).toContain("parallel");
      // Each member should know the other members' names so it can coordinate
      expect(code).toContain("architect");
      expect(code).toContain("senior-dev");
      expect(code).toContain("qa-engineer");
    });

    it("each member's prompt embeds the 11 built-in skills (parity with md mode)", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      // The skill prompts appear ONCE per member (3 members × N skills),
      // but each must appear at least once.
      expect(code).toContain("Caveman Mode");
      expect(code).toContain("Environment Awareness");
      expect(code).toContain("Autonomous Knowledge");
      expect(code).toContain("Self-Improvement");
      expect(code).toContain("Skill Combo");
      expect(code).toContain("Delegate to Specialized");
      expect(code).toContain("Team Coordination");
      expect(code).toContain("Context Window Discipline");
      expect(code).toContain("Workflow Orchestration");
      expect(code).toContain("Brainstorming");
      expect(code).toContain("Skill Creator");
    });

    it("describes management mode and the shared workspace blackboard", () => {
      const team = makeTeam({ management: "control" });
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      expect(code).toContain("Management style: control");
      expect(code).toContain("Shared workspace (blackboard)");
    });

    it("includes hera_remember and hera_recall memory tools", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      expect(code).toContain("hera_remember");
      expect(code).toContain("hera_recall");
      expect(code).not.toMatch(/tool:\s*\{\s*\}/);
    });

    it("does not import any hera-agent internals", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      expect(code).not.toMatch(/from\s+["'][^"']*hera-agent[^"']*["']/);
      expect(code).not.toContain("TeamManager");
      expect(code).not.toContain("MemoryStore");
    });
  });

  describe("writeToDisk", () => {
    it("writes a complete buildable package to disk", async () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const pkg = gen.generate(team, members, []);
      const out = join(tmp, "dev-team");
      await gen.writeToDisk(pkg, out);

      const pkgRaw = await readFile(join(out, "package.json"), "utf-8");
      JSON.parse(pkgRaw); // must be valid JSON
      const indexStat = await stat(join(out, "src/index.ts"));
      expect(indexStat.isFile()).toBe(true);
      const tsconfigRaw = await readFile(join(out, "tsconfig.json"), "utf-8");
      JSON.parse(tsconfigRaw);

      try {
        await rm(tmp, { recursive: true });
      } catch {}
    });
  });

  describe("installWithBuild", () => {
    it("runs install → build → add against the team plugin dir", async () => {
      const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
      const runner = async (cmd: string, args: string[], cwd: string) => {
        calls.push({ cmd, args, cwd });
        return { ok: true, stdout: "", stderr: "" };
      };
      const g = new TeamPluginGenerator(runner);
      const pluginDir = join(tmp, "dev-team");
      const configRoot = join(tmp, "opencode");
      const result = await g.installWithBuild(pluginDir, configRoot);
      expect(result.ok).toBe(true);
      expect(calls.length).toBe(3);
      expect(calls[0].args).toContain("install");
      expect(calls[1].args).toEqual(["run", "build"]);
      expect(calls[2].args[0]).toBe("add");
    });
  });
});
