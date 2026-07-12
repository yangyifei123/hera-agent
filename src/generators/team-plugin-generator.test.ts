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

    it("emits one team-scoped loader and a shared skills/ dir", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const pkg = gen.generate(team, members, []);
      const index = pkg.files.find((f) => f.path === "src/index.ts")!.content;
      const loaderMatches = index.match(/_load_skill: tool\(\{/g) ?? [];
      expect(loaderMatches).toHaveLength(1);
      expect(index).toContain(`${team.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_load_skill`);
      expect(pkg.files.some((f) => f.path === "skills/caveman/SKILL.md")).toBe(true);
      expect(index).not.toContain("hera_load_skill");
      const pkgJson = JSON.parse(pkg.files.find((f) => f.path === "package.json")!.content);
      expect(pkgJson.files).toContain("skills");
    });
  });

  describe("loader namespace hardening (unvalidated team names)", () => {
    const membersOf = (team: TeamDefinition) => team.members.map((m) => makeAgent(m.agentName));

    it("a team named 'hera' never emits hera_load_skill (collides with Hera's real loader)", () => {
      const team = makeTeam({ name: "hera" });
      const code = gen.generatePluginIndex(team, membersOf(team), []);
      expect(code).not.toContain("hera_load_skill");
      // Still exactly one loader, renamed deterministically.
      expect(code.match(/_load_skill: tool\(\{/g) ?? []).toHaveLength(1);
      expect(code).toContain("hera_team_load_skill");
      // Every member's manifest header references the renamed loader.
      const manifests = code.match(/## Skills \(load on demand with hera_team_load_skill\)/g) ?? [];
      expect(manifests).toHaveLength(3);
    });

    it("catches case variants like 'Hera' too", () => {
      const team = makeTeam({ name: "Hera" });
      const code = gen.generatePluginIndex(team, membersOf(team), []);
      expect(code).not.toContain("hera_load_skill");
      expect(code).toContain("hera_team_load_skill");
    });

    it("a non-ASCII team name still gets a non-empty, deterministic, per-team namespace", () => {
      const team = makeTeam({ name: "团队" });
      const code = gen.generatePluginIndex(team, membersOf(team), []);
      // Never the bare, un-namespaced `_load_skill`.
      expect(code).not.toMatch(/[^0-9A-Za-z_$]_load_skill: tool\(\{/);
      const key = code.match(/([A-Za-z_$][0-9A-Za-z_$]*)_load_skill: tool\(\{/);
      expect(key).not.toBeNull();
      // Deterministic: regenerating yields the same loader name.
      const again = gen.generatePluginIndex(team, membersOf(team), []);
      expect(again).toContain(`${key![1]}_load_skill: tool({`);
      // Two different non-ASCII team names must not collide on the loader name.
      const other = gen.generatePluginIndex(makeTeam({ name: "小组" }), membersOf(team), []);
      expect(other).not.toContain(`${key![1]}_load_skill: tool({`);
    });

    it("a digit-leading team name emits syntactically valid code", () => {
      const team = makeTeam({ name: "3d-squad" });
      const code = gen.generatePluginIndex(team, membersOf(team), []);
      // The loader object key must be a valid JS identifier (cannot start with a digit).
      expect(code).not.toMatch(/[^0-9A-Za-z_$]3d_squad_load_skill/);
      expect(code).toContain("team_3d_squad_load_skill");
      // The whole emitted module must parse (guards the plugin const name too).
      const transpiler = new Bun.Transpiler({ loader: "ts" });
      expect(() => transpiler.transformSync(code)).not.toThrow();
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

    it("each member's prompt bakes the skill manifest, not skill bodies (parity with md mode)", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      // One manifest section per member (3 members), all pointing at the
      // single team-scoped loader tool.
      const manifests = code.match(/## Skills \(load on demand with dev_team_load_skill\)/g) ?? [];
      expect(manifests).toHaveLength(3);
      // Skills appear as one-line manifest entries; full bodies are not embedded.
      expect(code).toContain("- caveman: Ultra-compressed communication mode.");
      expect(code).not.toContain("Caveman Mode");
      expect(code).not.toContain("## Built-in Skill:");
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

    it("does not import any hera-agent internals when withEngine is false (back-compat)", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, [], false);
      expect(code).not.toMatch(/from\s+["'][^"']*hera-agent[^"']*["']/);
      expect(code).not.toContain("TeamManager");
      expect(code).not.toContain("MemoryStore");
    });

    it("honors HERA_CONFIG_ROOT / OPENCODE_CONFIG_ROOT precedence before HERA_DIR", () => {
      const team = makeTeam();
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      expect(code).toContain("HERA_CONFIG_ROOT");
      expect(code).toContain("OPENCODE_CONFIG_ROOT");
      expect(code).toContain("hera-data");
      expect(code.indexOf("HERA_CONFIG_ROOT")).toBeLessThan(code.indexOf("HERA_DIR"));
    });
  });

  describe("engine injection", () => {
    it("injects createEngine wiring + hera-agent dep by default", () => {
      const team = makeTeam();
      const pkg = gen.generatePackageJson(team);
      expect(Object.keys(pkg.dependencies)).toContain("hera-agent");
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, []);
      expect(code).toContain('from "hera-agent/engine"');
      expect(code).toContain("createEngine(");
      expect(code).toContain("engine.start()");
      expect(code).toContain("...engine.tools");
    });

    it("omits engine wiring when withEngine is false", () => {
      const team = makeTeam();
      const pkg = gen.generatePackageJson(team, false);
      expect(Object.keys(pkg.dependencies)).not.toContain("hera-agent");
      const members = team.members.map((m) => makeAgent(m.agentName));
      const code = gen.generatePluginIndex(team, members, [], false);
      expect(code).not.toContain("hera-agent/engine");
      expect(code).not.toContain("createEngine(");
    });

    it("passes the first member as the engine judgeAgent", () => {
      const team = makeTeam();
      const code = gen.generatePluginIndex(team, [makeAgent("alpha"), makeAgent("beta")], []);
      expect(code).toContain('judgeAgent: "alpha"');
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
