/**
 * Hera First-Run Onboarding
 * Creates default agents and team on first load
 */

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRegistry } from "./agents/registry.js";
import type { TeamManager } from "./team/manager.js";
import type { MemoryStore } from "./memory/store.js";
import type { SkillManager } from "./skills/manager.js";
import type { TeamDefinition, HeraPaths } from "./types.js";
import { createAgentFromTemplate } from "./agents/hera.js";
import { heraLog } from "./logger.js";

const ONBOARDING_FLAG = ".onboarded";

export function isFirstRun(paths: HeraPaths): boolean {
  // Check if .onboarded exists in hera-data/
  const flagPath = join(paths.dataDir, ONBOARDING_FLAG);
  // Synchronous check during init phase
  try {
    // Use require for synchronous existence check
    require("fs").accessSync(flagPath);
    return false;
  } catch {
    return true;
  }
}

export async function runOnboarding(
  paths: HeraPaths,
  agentRegistry: AgentRegistry,
  teamManager: TeamManager,
  store: MemoryStore,
  skillManager: SkillManager
): Promise<void> {
  const flagPath = join(paths.dataDir, ONBOARDING_FLAG);

  // Create default agent: quick-fixer (mode: subagent, template: debugger)
  const skills = skillManager.getSkillMap();
  try {
    const quickFixerDef = createAgentFromTemplate("debugger", "quick-fixer");
    await agentRegistry.register(quickFixerDef, skills);
    heraLog("info", "Onboarding: Created default agent 'quick-fixer' (debugger template)");
  } catch (err) {
    heraLog("warn", "Onboarding: Could not create quick-fixer agent (may already exist)", err);
  }

  // Create default team: dev-team (sequential, members: architect, senior-dev, qa-engineer)
  // These agents need to exist first — check if templates exist or use placeholders
  const devTeam: TeamDefinition = {
    name: "dev-team",
    description: "Full dev team: architect designs → senior-dev implements → qa-engineer tests. Sequential pipeline for feature development.",
    coordination: "sequential",
    members: [
      { agentName: "architect", role: "architect", subscriptions: ["message", "task", "result"], backendType: "in-process" },
      { agentName: "senior-dev", role: "developer", subscriptions: ["message", "task", "result"], backendType: "in-process" },
      { agentName: "qa-engineer", role: "tester", subscriptions: ["message", "task", "result"], backendType: "in-process" },
    ],
    createdAt: Date.now(),
  };

  try {
    await teamManager.createTeam(devTeam);
    heraLog("info", "Onboarding: Created default team 'dev-team' (sequential)");
  } catch (err) {
    heraLog("warn", "Onboarding: Could not create dev-team (may already exist)", err);
  }

  // Write onboarding flag
  try {
    await writeFile(flagPath, JSON.stringify({ timestamp: Date.now() }, null, 2), "utf-8");
    heraLog("info", "Onboarding: Complete — flag written to " + flagPath);
  } catch (err) {
    heraLog("warn", "Onboarding: Could not write .onboarded flag", err);
  }
}