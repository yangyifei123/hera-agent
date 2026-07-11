import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupAgent,
  listBackups,
  migrateLegacyAgentMarkdown,
  persistAgent,
  removeAgent,
  restoreAgent,
} from "./persistence.js";
import type { AgentDefinition, SkillDefinition } from "./types.js";
import type { AgentRegistry } from "./agents/registry.js";
import { AgentRegistry as RealAgentRegistry } from "./agents/registry.js";
import type { MemoryStore } from "./memory/store.js";
import { MemoryStore as RealMemoryStore } from "./memory/store.js";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

// --- Mock Factories ---

function makeAgentDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "test-agent",
    description: "Test",
    mode: "subagent",
    prompt: "You are test.",
    skills: ["caveman", "init", "memory", "evolution"],
    createdAt: Date.now(),
    evolutionLog: [],
    ...overrides,
  };
}

function makeMockRegistry() {
  return {
    register: mock(async () => ({
      config: { description: "test", mode: "subagent" },
      fileWritten: "/agents/hera/test-agent.md",
    })),
    unregister: mock(async () => true),
  } as unknown as AgentRegistry;
}

function makeMockStore() {
  return {
    save: mock(async () => {}),
    delete: mock(async () => true),
  } as unknown as MemoryStore;
}

describe("persistAgent", () => {
  let registeredAgents: Map<string, AgentDefinition>;
  let registry: AgentRegistry;
  let store: MemoryStore;
  let skillsMap: Map<string, SkillDefinition>;

  beforeEach(() => {
    registeredAgents = new Map();
    registry = makeMockRegistry();
    store = makeMockStore();
    skillsMap = new Map();
  });

  it("sets agent in registeredAgents", async () => {
    const def = makeAgentDef();
    await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(registeredAgents.get("test-agent")).toBe(def);
  });

  it("calls agentRegistry.register with def and skills", async () => {
    const def = makeAgentDef();
    await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(registry.register).toHaveBeenCalledWith(def, skillsMap);
    expect(registry.register).toHaveBeenCalledTimes(1);
  });

  it("calls store.save with correct memory structure", async () => {
    const def = makeAgentDef();
    await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(store.save).toHaveBeenCalledTimes(1);
    const savedArg = (store.save as any).mock.calls[0][0];
    expect(savedArg.id).toBe("agent-test-agent");
    expect(savedArg.type).toBe("agent");
    expect(savedArg.content).toBe(JSON.stringify(def));
    expect(savedArg.metadata.mode).toBe("subagent");
    expect(savedArg.metadata.fileWritten).toBe("/agents/hera/test-agent.md");
    expect(typeof savedArg.timestamp).toBe("number");
  });

  it("returns config, fileWritten, and memoryId", async () => {
    const def = makeAgentDef();
    const result = await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(result.config).toEqual({ description: "test", mode: "subagent" });
    expect(result.fileWritten).toBe("/agents/hera/test-agent.md");
    expect(result.memoryId).toBe("agent-test-agent");
  });

  it("overwrites existing agent in registeredAgents", async () => {
    const oldDef = makeAgentDef({ description: "old" });
    registeredAgents.set("test-agent", oldDef);
    const newDef = makeAgentDef({ description: "new" });
    await persistAgent(newDef, skillsMap, registeredAgents, registry, store);
    expect(registeredAgents.get("test-agent")).toBe(newDef);
    expect(registeredAgents.get("test-agent")!.description).toBe("new");
  });
});

describe("removeAgent", () => {
  let registeredAgents: Map<string, AgentDefinition>;
  let registry: AgentRegistry;
  let store: MemoryStore;

  beforeEach(() => {
    registeredAgents = new Map();
    registeredAgents.set("test-agent", makeAgentDef());
    registry = makeMockRegistry();
    store = makeMockStore();
  });

  it("deletes from registeredAgents", async () => {
    await removeAgent("test-agent", registeredAgents, registry, store);
    expect(registeredAgents.has("test-agent")).toBe(false);
  });

  it("calls agentRegistry.unregister", async () => {
    await removeAgent("test-agent", registeredAgents, registry, store);
    expect(registry.unregister).toHaveBeenCalledWith("test-agent");
    expect(registry.unregister).toHaveBeenCalledTimes(1);
  });

  it("calls store.delete with correct args", async () => {
    await removeAgent("test-agent", registeredAgents, registry, store);
    expect(store.delete).toHaveBeenCalledWith("agent", "agent-test-agent");
    expect(store.delete).toHaveBeenCalledTimes(1);
  });

  it("returns store.delete result", async () => {
    const result = await removeAgent("test-agent", registeredAgents, registry, store);
    expect(result).toBe(true);
  });

  it("handles missing agent gracefully", async () => {
    const result = await removeAgent("nonexistent", registeredAgents, registry, store);
    expect(result).toBe(true);
    expect(registry.unregister).toHaveBeenCalledWith("nonexistent");
  });
});

describe("backup/list/restore integration", () => {
  let tmp: string;
  let registry: RealAgentRegistry;
  let store: RealMemoryStore;
  let registeredAgents: Map<string, AgentDefinition>;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-persistence-test-"));
    registry = new RealAgentRegistry(join(tmp, "agents", "hera"));
    await registry.init();
    store = new RealMemoryStore(join(tmp, "hera-data", "memory"));
    await store.init();
    registeredAgents = new Map();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("stores backups under configRoot/hera-data/backups", async () => {
    const def = makeAgentDef({ name: "backed-up-agent" });

    await persistAgent(def, new Map(), registeredAgents, registry, store);
    await backupAgent("backed-up-agent", registeredAgents, registry);

    const backups = await listBackups("backed-up-agent", registeredAgents, registry);
    expect(backups).toHaveLength(1);

    const expectedDir = normalizePath(join(tmp, "hera-data", "backups"));
    expect(normalizePath(backups[0].filePath).startsWith(expectedDir)).toBe(true);
  });

  it("does not cross-match a shorter agent name against a longer one's backups", async () => {
    // "qa" is a prefix of "qa-engineer": a naive startsWith filter would treat
    // qa-engineer's backups as qa's, letting a qa restore/prune clobber them.
    const qa = makeAgentDef({ name: "qa" });
    const qaEng = makeAgentDef({ name: "qa-engineer" });
    await persistAgent(qa, new Map(), registeredAgents, registry, store);
    await persistAgent(qaEng, new Map(), registeredAgents, registry, store);
    await backupAgent("qa", registeredAgents, registry);
    await backupAgent("qa-engineer", registeredAgents, registry);

    const qaBackups = await listBackups("qa", registeredAgents, registry);
    const qaEngBackups = await listBackups("qa-engineer", registeredAgents, registry);
    expect(qaBackups).toHaveLength(1);
    expect(qaEngBackups).toHaveLength(1);
    expect(qaBackups[0].filePath).not.toEqual(qaEngBackups[0].filePath);
    // qa's listing must not include the qa-engineer backup file.
    expect(qaBackups[0].filePath).not.toContain("qa-engineer");
  });

  it("restores markdown with the skill manifest re-rendered", async () => {
    const customSkill: SkillDefinition = {
      name: "custom-skill",
      description: "Custom skill",
      trigger: "custom",
      prompt: "CUSTOM_SKILL_BODY",
      category: "user",
    };
    const skillsMap = new Map<string, SkillDefinition>([[customSkill.name, customSkill]]);
    const def = makeAgentDef({
      name: "restorable-agent",
      skills: ["caveman", customSkill.name],
    });

    await persistAgent(def, skillsMap, registeredAgents, registry, store);

    const originalMarkdown = await readFile(
      join(tmp, "agents", "hera", "restorable-agent.md"),
      "utf-8"
    );
    // Progressive disclosure: the manifest line is embedded, never the body.
    expect(originalMarkdown).toContain(`- ${customSkill.name}:`);
    expect(originalMarkdown).not.toContain("CUSTOM_SKILL_BODY");

    await removeAgent("restorable-agent", registeredAgents, registry, store);

    const result = await restoreAgent(
      "restorable-agent",
      undefined,
      skillsMap,
      registeredAgents,
      registry,
      store
    );

    expect(result.success).toBe(true);

    const restoredMarkdown = await readFile(
      join(tmp, "agents", "hera", "restorable-agent.md"),
      "utf-8"
    );
    expect(restoredMarkdown).toContain(`- ${customSkill.name}:`);
    expect(restoredMarkdown).not.toContain("CUSTOM_SKILL_BODY");
  });

  it("migrates legacy full-body agent markdown to manifest form, once", async () => {
    const skillsMap = new Map<string, SkillDefinition>();
    const def = makeAgentDef({ name: "legacy-agent" });
    await persistAgent(def, skillsMap, registeredAgents, registry, store);

    // Forge a legacy file: inject a full-body skill section like pre-migration builds.
    const file = join(tmp, "agents", "hera", "legacy-agent.md");
    const current = await readFile(file, "utf-8");
    await writeFile(file, current + "\n## Built-in Skill: Caveman\nFULL LEGACY BODY\n");

    const migrated = await migrateLegacyAgentMarkdown(registeredAgents, skillsMap, registry);
    expect(migrated).toEqual(["legacy-agent"]);

    const after = await readFile(file, "utf-8");
    expect(after).not.toContain("## Built-in Skill:");
    // A backup snapshot exists.
    const backups = await listBackups("legacy-agent", registeredAgents, registry);
    expect(backups.length).toBeGreaterThan(0);

    // Second run is a no-op.
    expect(await migrateLegacyAgentMarkdown(registeredAgents, skillsMap, registry)).toEqual([]);
  });

  it("migrates genuine pre-promptB64 legacy files idempotently (readDefinition body-fallback)", async () => {
    const skillsMap = new Map<string, SkillDefinition>();

    // Forge a file exactly as pre-promptB64 builds wrote them: frontmatter
    // WITHOUT promptB64, body = "# Agent:" header + raw prompt + full
    // embedded skill bodies (commit b87497c-era rendering).
    const file = join(tmp, "agents", "hera", "old-agent.md");
    const legacyFile = [
      "---",
      "name: old-agent",
      'description: "Old agent"',
      "mode: subagent",
      'skillsJson: ["caveman","init","memory","evolution"]',
      "---",
      "",
      "# Agent: old-agent",
      "",
      "You are old.",
      "",
      "## Built-in Skill: Caveman",
      "FULL CAVEMAN BODY",
      "",
      "## Built-in Skill: Memory",
      "FULL MEMORY BODY",
      "",
    ].join("\n");
    await writeFile(file, legacyFile);

    // Load the def via readDefinition exactly like startup does (index.ts):
    // with no promptB64, def.prompt falls back to the whole rendered body.
    const def = await registry.readDefinition("old-agent");
    expect(def).not.toBeNull();
    expect(def!.prompt).toContain("## Built-in Skill:");
    registeredAgents.set("old-agent", def!);

    // First run migrates: marker and skill bodies gone, header not duplicated.
    expect(await migrateLegacyAgentMarkdown(registeredAgents, skillsMap, registry)).toEqual([
      "old-agent",
    ]);
    const after1 = await readFile(file, "utf-8");
    expect(after1).not.toContain("## Built-in Skill:");
    expect(after1).not.toContain("FULL CAVEMAN BODY");
    expect(after1.match(/# Agent: old-agent/g)).toHaveLength(1);

    // The raw author prompt survives — in memory and across a reload.
    expect(registeredAgents.get("old-agent")!.prompt).toBe("You are old.");
    const reloaded = await registry.readDefinition("old-agent");
    expect(reloaded!.prompt).toBe("You are old.");

    // Second run is a no-op: nothing migrated, no extra backup, file unchanged.
    expect(await listBackups("old-agent", registeredAgents, registry)).toHaveLength(1);
    expect(await migrateLegacyAgentMarkdown(registeredAgents, skillsMap, registry)).toEqual([]);
    expect(await listBackups("old-agent", registeredAgents, registry)).toHaveLength(1);
    expect(await readFile(file, "utf-8")).toBe(after1);
  });
});
