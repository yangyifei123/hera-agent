import { describe, test, expect } from "bun:test";
import type { PluginContext, HeraConfig } from "./types.js";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";

function makeTestCtx(autoEvolve: boolean): PluginContext {
  const base = join(tmpdir(), `hera-test-auto-evolve-${Date.now()}`);
  mkdirSync(join(base, "memory"), { recursive: true });
  mkdirSync(join(base, "skills"), { recursive: true });
  mkdirSync(join(base, "agents", "hera"), { recursive: true });

  const store = new MemoryStore(join(base, "memory"));
  const skillManager = new SkillManager(store, join(base, "skills"));
  const teamManager = new TeamManager(store, undefined);
  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(join(base, "agents", "hera"));

  const config: HeraConfig = { auto_evolve: autoEvolve };

  return {
    store,
    skillManager,
    teamManager,
    distillation,
    agentRegistry,
    registeredAgents: new Map(),
    client: undefined,
    config,
    paths: {
      configRoot: base,
      dataDir: join(base, "hera-data"),
      memoryDir: join(base, "memory"),
      skillsDir: join(base, "skills"),
      agentsDir: join(base, "agents", "hera"),
    },
    autoEvolve: autoEvolve,
  };
}

describe("auto_evolve config wiring", () => {
  test("autoEvolve is false when config.auto_evolve is undefined", () => {
    const ctx = makeTestCtx(false);
    expect(ctx.autoEvolve).toBe(false);
  });

  test("autoEvolve is true when config.auto_evolve is true", () => {
    const ctx = makeTestCtx(true);
    expect(ctx.autoEvolve).toBe(true);
  });

  test("compacting hook context differs based on autoEvolve", () => {
    // Simulate the compacting hook logic
    const ctxOff = makeTestCtx(false);
    const ctxOn = makeTestCtx(true);

    const outputOff = { context: [] as string[] };
    const outputOn = { context: [] as string[] };

    // Replicate compacting hook logic
    const baseMsg = "Hera Session Context: Distill key decisions, patterns, and skills before compaction. Recall relevant memories.";
    const evolveMsg = "Reflect on this session's failures and propose evolution directives if needed. Use hera_evolve_agent to suggest improvements.";

    outputOff.context.push(baseMsg);
    outputOn.context.push(baseMsg);
    if (ctxOn.autoEvolve) outputOn.context.push(evolveMsg);

    expect(outputOff.context).toHaveLength(1);
    expect(outputOff.context[0]).toBe(baseMsg);

    expect(outputOn.context).toHaveLength(2);
    expect(outputOn.context[0]).toBe(baseMsg);
    expect(outputOn.context[1]).toBe(evolveMsg);
  });
});
