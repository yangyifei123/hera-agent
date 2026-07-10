// src/generators/command-fragment.test.ts
//
// Locks the A3 exporter behavior: generated plugins ship native OpenCode
// `/<name>` command files so bundled agents get keyword commands the way
// omo-style plugins do. Covers the shared `generateCommandsFragment` and both
// the single-agent and team generators' command wiring.
import { describe, it, expect } from "bun:test";
import { generateCommandsFragment, PluginGenerator } from "./plugin-generator.js";
import { TeamPluginGenerator } from "./team-plugin-generator.js";
import type { AgentDefinition, TeamDefinition } from "../types.js";

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

function makeTeam(overrides?: Partial<TeamDefinition>): TeamDefinition {
  return {
    name: "greek",
    description: "Philosophers who interpret books",
    coordination: "adaptive",
    members: [
      { agentName: "socrates", role: "questioner", subscriptions: [], backendType: "in-process" },
      { agentName: "plato", role: "theorist", subscriptions: [], backendType: "in-process" },
    ],
    ...overrides,
  };
}

describe("generateCommandsFragment", () => {
  it("returns empty helper and call for an empty spec list", () => {
    const { helper, call } = generateCommandsFragment([]);
    expect(helper).toBe("");
    expect(call).toBe("");
  });

  it("emits a runtime writer honoring HERA_CONFIG_ROOT with one entry per spec", () => {
    const { helper, call } = generateCommandsFragment([
      { name: "socrates", agent: "socrates", description: "Consult Socrates" },
      { name: "plato", agent: "plato", description: "Ask Plato" },
    ]);
    expect(helper).toContain("function getCommandDir()");
    expect(helper).toContain("HERA_CONFIG_ROOT");
    expect(helper).toContain("OPENCODE_CONFIG_ROOT");
    expect(helper).toContain("async function writePluginCommands()");
    expect(helper).toContain("const PLUGIN_COMMANDS");
    // Each spec becomes an entry routing the command to its agent.
    expect(helper).toContain('"name": "socrates"');
    expect(helper).toContain('"agent": "socrates"');
    expect(helper).toContain('"name": "plato"');
    // The plugin body invokes the writer.
    expect(call).toBe("  await writePluginCommands();\n");
  });

  it("sanitizes descriptions so they cannot break the YAML front-matter line", () => {
    const { helper } = generateCommandsFragment([
      { name: "diogenes", agent: "diogenes", description: 'He said: "be bold"\nlive simply' },
    ]);
    // Colons, quotes and newlines are stripped/collapsed.
    expect(helper).toContain('"description": "He said be bold live simply"');
    expect(helper).not.toContain('be bold"');
  });

  it("falls back to a safe description when the input is empty", () => {
    const { helper } = generateCommandsFragment([
      { name: "aristotle", agent: "aristotle", description: "   " },
    ]);
    expect(helper).toContain('"description": "OpenCode agent"');
  });

  it("skips specs whose name is unsafe (path traversal / bad charset)", () => {
    const { helper, call } = generateCommandsFragment([
      { name: "../escape", agent: "x", description: "d" },
      { name: "Bad Name", agent: "x", description: "d" },
    ]);
    // No safe spec survived → no command support emitted at all.
    expect(helper).toBe("");
    expect(call).toBe("");
  });

  it("drops duplicate command names (silent last-writer collisions)", () => {
    const { helper } = generateCommandsFragment([
      { name: "socrates", agent: "socrates", description: "first" },
      { name: "socrates", agent: "impostor", description: "second" },
    ]);
    const occurrences = helper.split('"name": "socrates"').length - 1;
    expect(occurrences).toBe(1);
    // The first spec wins.
    expect(helper).toContain('"agent": "socrates"');
    expect(helper).not.toContain('"agent": "impostor"');
  });

  it("sanitizes the agent field so it cannot inject front-matter at runtime", () => {
    const { helper } = generateCommandsFragment([
      { name: "socrates", agent: "socrates\npermission: allow", description: "d" },
    ]);
    expect(helper).toContain('"agent": "socratespermissionallow"');
    expect(helper).not.toContain('"agent": "socrates\\npermission');
  });

  it("emits an ownership marker + guard so a reload cannot clobber foreign commands", () => {
    const { helper } = generateCommandsFragment([
      { name: "socrates", agent: "socrates", description: "d" },
    ]);
    expect(helper).toContain("GENERATED_COMMAND_MARKER");
    expect(helper).toContain("generated-by: hera-plugin");
    // The writer reads an existing file and skips it when the marker is absent.
    expect(helper).toContain("await readFile(file");
    expect(helper).toContain("if (!existing.includes(GENERATED_COMMAND_MARKER)) continue;");
  });
});

describe("PluginGenerator command wiring (single agent)", () => {
  const gen = new PluginGenerator();

  it("writes a /<agent> command by default", () => {
    const code = gen.generatePluginIndex(makeAgent("socrates"), [], true);
    expect(code).toContain("await writePluginCommands();");
    expect(code).toContain('"name": "socrates"');
    expect(code).toContain('"agent": "socrates"');
  });

  it("omits command wiring when withCommands is false", () => {
    const code = gen.generatePluginIndex(makeAgent("socrates"), [], true, false);
    expect(code).not.toContain("writePluginCommands");
    expect(code).not.toContain("PLUGIN_COMMANDS");
  });

  it("generate() includes command wiring in the emitted src/index.ts by default", () => {
    const pkg = gen.generate(makeAgent("socrates"), []);
    const index = pkg.files.find((f) => f.path === "src/index.ts");
    expect(index!.content).toContain("await writePluginCommands();");
  });

  it("generate({ withCommands: false }) omits it", () => {
    const pkg = gen.generate(makeAgent("socrates"), [], { withCommands: false });
    const index = pkg.files.find((f) => f.path === "src/index.ts");
    expect(index!.content).not.toContain("writePluginCommands");
  });
});

describe("TeamPluginGenerator command wiring", () => {
  const gen = new TeamPluginGenerator();

  it("writes a command per member routing /<member> to that member agent by default", () => {
    const team = makeTeam();
    const members = team.members.map((m) => makeAgent(m.agentName));
    const code = gen.generatePluginIndex(team, members, []);
    expect(code).toContain("await writePluginCommands();");
    expect(code).toContain('"name": "socrates"');
    expect(code).toContain('"agent": "socrates"');
    expect(code).toContain('"name": "plato"');
    expect(code).toContain('"agent": "plato"');
  });

  it("omits command wiring when withCommands is false", () => {
    const team = makeTeam();
    const members = team.members.map((m) => makeAgent(m.agentName));
    const code = gen.generatePluginIndex(team, members, [], true, false);
    expect(code).not.toContain("writePluginCommands");
    expect(code).not.toContain("PLUGIN_COMMANDS");
  });

  it("generate() bakes command wiring into src/index.ts by default", () => {
    const team = makeTeam();
    const members = team.members.map((m) => makeAgent(m.agentName));
    const pkg = gen.generate(team, members, []);
    const index = pkg.files.find((f) => f.path === "src/index.ts");
    expect(index!.content).toContain("await writePluginCommands();");
  });

  it("generate({ withCommands: false }) omits it", () => {
    const team = makeTeam();
    const members = team.members.map((m) => makeAgent(m.agentName));
    const pkg = gen.generate(team, members, [], { withCommands: false });
    const index = pkg.files.find((f) => f.path === "src/index.ts");
    expect(index!.content).not.toContain("writePluginCommands");
  });
});
