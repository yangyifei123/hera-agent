/**
 * Hera First-Run Onboarding
 * Creates default agents and team on first load
 */

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  // Synchronous existence check during the init phase. Uses existsSync (not
  // require("fs"), which is undefined under pure ESM and would make this throw,
  // get swallowed, and re-onboard on every launch).
  return !existsSync(join(paths.dataDir, ONBOARDING_FLAG));
}

export async function runOnboarding(
  paths: HeraPaths,
  agentRegistry: AgentRegistry,
  teamManager: TeamManager,
  store: MemoryStore,
  skillManager: SkillManager
): Promise<void> {
  const flagPath = join(paths.dataDir, ONBOARDING_FLAG);
  const failures: string[] = [];

  // Create default agent: quick-fixer (mode: subagent, template: debugger)
  const skills = skillManager.getSkillMap();
  try {
    const existingQuickFixer = await agentRegistry.readDefinition("quick-fixer");
    if (existingQuickFixer) {
      heraLog("info", "Onboarding: keeping existing quick-fixer agent (user-created)");
    } else {
      const quickFixerDef = createAgentFromTemplate("debugger", "quick-fixer");
      await agentRegistry.register(quickFixerDef, skills);
      heraLog("info", "Onboarding: Created default agent 'quick-fixer' (debugger template)");
    }
  } catch (err) {
    failures.push("quick-fixer");
    heraLog("warn", "Onboarding: Could not create quick-fixer agent", err);
  }

  // Create the dev-team member agents BEFORE the team itself, so the team
  // is not born referencing nonexistent agents (the "ghost team" bug).
  const teamMembers: Array<{ name: string; template: "architect" | "coder" | "tester" }> = [
    { name: "architect", template: "architect" },
    { name: "senior-dev", template: "coder" },
    { name: "qa-engineer", template: "tester" },
  ];
  for (const m of teamMembers) {
    try {
      const existing = await agentRegistry.readDefinition(m.name);
      if (existing) {
        heraLog("info", `Onboarding: keeping existing '${m.name}' agent (user-created)`);
        continue;
      }
      const def = createAgentFromTemplate(m.template, m.name);
      await agentRegistry.register(def, skills);
      heraLog("info", `Onboarding: Created team member '${m.name}' (${m.template} template)`);
    } catch (err) {
      failures.push(m.name);
      heraLog("warn", `Onboarding: Could not create team member '${m.name}'`, err);
    }
  }

  // Create default team: dev-team (sequential, members: architect, senior-dev, qa-engineer)
  const devTeam: TeamDefinition = {
    name: "dev-team",
    description:
      "Full dev team: architect designs → senior-dev implements → qa-engineer tests. Sequential pipeline for feature development.",
    coordination: "sequential",
    members: [
      {
        agentName: "architect",
        role: "architect",
        subscriptions: ["message", "task", "result"],
        backendType: "in-process",
      },
      {
        agentName: "senior-dev",
        role: "developer",
        subscriptions: ["message", "task", "result"],
        backendType: "in-process",
      },
      {
        agentName: "qa-engineer",
        role: "tester",
        subscriptions: ["message", "task", "result"],
        backendType: "in-process",
      },
    ],
    createdAt: Date.now(),
  };

  try {
    if (teamManager.getTeam(devTeam.name)) {
      heraLog("info", "Onboarding: keeping existing 'dev-team' team (user-created)");
    } else {
      await teamManager.createTeam(devTeam);
      heraLog("info", "Onboarding: Created default team 'dev-team' (sequential)");
    }
  } catch (err) {
    failures.push("dev-team");
    heraLog("warn", "Onboarding: Could not create dev-team", err);
  }

  // Only mark onboarding complete when every default was created. Writing the
  // flag on partial failure would permanently lock in a broken setup (isFirstRun
  // never returns true again, so onboarding never retries). On failure, leave the
  // flag unwritten so the next launch re-attempts the missing pieces.
  if (failures.length > 0) {
    heraLog(
      "warn",
      `Onboarding: incomplete — failed to create [${failures.join(", ")}]; will retry on next launch.`
    );
    return;
  }

  try {
    await writeFile(flagPath, JSON.stringify({ timestamp: Date.now() }, null, 2), "utf-8");
    heraLog("info", "Onboarding: Complete — flag written to " + flagPath);
  } catch (err) {
    heraLog("warn", "Onboarding: Could not write .onboarded flag", err);
  }
}
