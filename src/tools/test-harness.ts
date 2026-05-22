/**
 * Shared test setup: builds a real PluginContext on a tmp dir.
 * Used by tool integration tests so the same wiring isn't duplicated
 * across agent-tools/team-tools/skill-tools test files.
 */

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "../agents/registry.js";
import { TeamManager } from "../team/manager.js";
import { MemoryStore } from "../memory/store.js";
import { SkillManager } from "../skills/manager.js";
import { DistillationEngine } from "../distillation/engine.js";
import { WorkflowManager } from "../workflow/manager.js";
import type { AgentDefinition, PluginContext } from "../types.js";

export interface TestHarness {
  ctx: PluginContext;
  tmp: string;
  cleanup: () => Promise<void>;
}

export async function makeTestHarness(): Promise<TestHarness> {
  const tmp = await mkdtemp(join(tmpdir(), "hera-tool-test-"));
  const configRoot = tmp;
  const dataDir = join(tmp, "hera-data");
  const memoryDir = join(dataDir, "memory");
  const skillsDir = join(dataDir, "skills");
  const agentsDir = join(tmp, "agents", "hera");

  await mkdir(dataDir, { recursive: true });

  const store = new MemoryStore(memoryDir);
  await store.init();

  const skillManager = new SkillManager(store, skillsDir);
  await skillManager.init();

  const agentRegistry = new AgentRegistry(agentsDir);
  await agentRegistry.init();

  const teamManager = new TeamManager(store, undefined);
  await teamManager.init();

  const workflowManager = new WorkflowManager(store, teamManager, undefined);
  await workflowManager.init();

  const distillation = new DistillationEngine(store);

  const registeredAgents = new Map<string, AgentDefinition>();

  const ctx: PluginContext = {
    store,
    skillManager,
    teamManager,
    workflowManager,
    distillation,
    agentRegistry,
    registeredAgents,
    client: undefined,
    config: {},
    paths: {
      configRoot,
      dataDir,
      memoryDir,
      skillsDir,
      agentsDir,
    },
    autoEvolve: false,
  };

  return {
    ctx,
    tmp,
    cleanup: async () => {
      try {
        await rm(tmp, { recursive: true });
      } catch {}
    },
  };
}
