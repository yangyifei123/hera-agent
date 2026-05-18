import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUBAGENT_SKILL, getSubagentPrompt } from "./subagent.js";
import { COMMUNICATE_SKILL } from "./communicate.js";
import { AUTO_COMPACT_SKILL } from "./auto-compact.js";
import { SkillManager } from "./manager.js";
import { MemoryStore } from "../memory/store.js";
import { DEFAULT_SKILLS } from "../constants.js";
import { buildAgentPrompt } from "../agents/hera.js";
import type { AgentDefinition } from "../types.js";

describe("SUBAGENT_SKILL", () => {
  it("should export a SkillDefinition with correct identity", () => {
    expect(SUBAGENT_SKILL.name).toBe("subagent");
    expect(SUBAGENT_SKILL.category).toBe("builtin");
    expect(SUBAGENT_SKILL.description).toBeTruthy();
    expect(SUBAGENT_SKILL.trigger).toBeTruthy();
    expect(SUBAGENT_SKILL.prompt).toBeTruthy();
  });

  it("prompt should teach when to delegate work", () => {
    const p = SUBAGENT_SKILL.prompt;
    expect(p.toLowerCase()).toContain("subagent");
    // Must reference Hera's spawn tool so the agent knows how to delegate.
    expect(p).toContain("hera_spawn_agent");
  });

  it("getSubagentPrompt returns the same content", () => {
    expect(getSubagentPrompt()).toBe(SUBAGENT_SKILL.prompt);
  });
});

describe("new builtin skills — integration", () => {
  let tmp: string;
  let store: MemoryStore;
  let skills: SkillManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-skill-integ-"));
    store = new MemoryStore(join(tmp, "memory"));
    await store.init();
    skills = new SkillManager(store, join(tmp, "skills"));
    await skills.init();
  });

  it("SkillManager loads subagent/communicate/auto-compact as builtin skills", () => {
    const map = skills.getSkillMap();
    expect(map.has("subagent")).toBe(true);
    expect(map.has("communicate")).toBe(true);
    expect(map.has("auto-compact")).toBe(true);
    expect(map.get("subagent")?.category).toBe("builtin");
  });

  it("DEFAULT_SKILLS includes all 7 builtin skill names", () => {
    expect(DEFAULT_SKILLS).toContain("caveman");
    expect(DEFAULT_SKILLS).toContain("init");
    expect(DEFAULT_SKILLS).toContain("memory");
    expect(DEFAULT_SKILLS).toContain("evolution");
    expect(DEFAULT_SKILLS).toContain("skill-combo");
    expect(DEFAULT_SKILLS).toContain("subagent");
    expect(DEFAULT_SKILLS).toContain("communicate");
    expect(DEFAULT_SKILLS).toContain("auto-compact");
  });

  it("buildAgentPrompt embeds all 7 builtin skill prompts", () => {
    const def: AgentDefinition = {
      name: "test",
      description: "test",
      mode: "subagent",
      prompt: "BASE",
      skills: [...DEFAULT_SKILLS],
    };
    const out = buildAgentPrompt(def, []);
    expect(out).toContain("Caveman Mode");
    expect(out).toContain("Environment Awareness");
    expect(out).toContain("Autonomous Knowledge Persistence");
    expect(out).toContain("Self-Improvement");
    expect(out).toContain("Skill Combo");
    expect(out).toContain("Delegate to Specialized Agents");
    expect(out).toContain("Team Coordination");
    expect(out).toContain("Context Window Discipline");
  });

  async function cleanup() {
    try { await rm(tmp, { recursive: true }); } catch {}
  }
});
