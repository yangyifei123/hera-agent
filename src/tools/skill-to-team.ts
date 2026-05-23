/**
 * Skill → Team upgrade — promotes a set of skills into a coordinated team
 * where each skill becomes its own member agent. The team is created with
 * the chosen coordination/management mode, and member agents are persisted
 * with full Hera built-in skill prompts via the standard persistAgent path.
 *
 * This module is intentionally framework-free so it can be unit tested in
 * isolation. The hera_upgrade_to_team tool is a thin wrapper around it.
 */

import type { AgentDefinition, TeamDefinition, TeamMember } from "../types.js";
import type { SkillManager } from "../skills/manager.js";
import type { TeamManager } from "../team/manager.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { MemoryStore } from "../memory/store.js";
import { DEFAULT_CHILD_MAX_STEPS } from "../constants.js";
import { getDefaultSkills } from "../helpers.js";
import { persistAgent } from "../persistence.js";

/** Derive a unique member agent name from team + skill. */
export function memberAgentNameForSkill(teamName: string, skillName: string): string {
  return `${teamName}-${skillName}`;
}

const ROLE_BY_SKILL: Record<string, string> = {
  security: "security auditor",
  perf: "performance optimizer",
  performance: "performance optimizer",
  review: "code reviewer",
  reviewer: "code reviewer",
  research: "researcher",
  researcher: "researcher",
  test: "test engineer",
  testing: "test engineer",
  qa: "qa engineer",
  debug: "debugger",
  doc: "documenter",
  docs: "documenter",
  architect: "architect",
  architecture: "architect",
  code: "coder",
  coder: "coder",
};

/** Infer a friendly role from a skill name; falls back to the raw skill name. */
export function inferRoleFromSkill(skillName: string): string {
  return ROLE_BY_SKILL[skillName] ?? `${skillName} specialist`;
}

export interface UpgradeSkillsToTeamArgs {
  skillNames: string[];
  teamName: string;
  description: string;
  coordination: "parallel" | "sequential" | "adaptive";
  management?: "simple" | "okr" | "tree" | "control";
  /** Override the agent mode for every member (default: subagent). */
  memberMode?: "primary" | "subagent" | "all";
  /** Preview planned agents/team without writing anything. */
  dryRun?: boolean;

  skillManager: SkillManager;
  teamManager: TeamManager;
  agentRegistry: AgentRegistry;
  store: MemoryStore;
  registeredAgents: Map<string, AgentDefinition>;
}

export interface UpgradeSkillsToTeamResult {
  ok: boolean;
  error?: string;
  createdAgents: string[];
  team?: TeamDefinition;
  preview?: string;
  warnings?: string[];
}

/**
 * Build a member agent prompt that delegates the agent's specialty to the
 * named skill. Built-in skills (caveman/init/memory/...) are embedded by
 * persistAgent → AgentRegistry → buildAgentPrompt, so we only need to set
 * the agent's intent here.
 */
function buildMemberPrompt(skillName: string, role: string): string {
  return [
    `You are a ${role} specializing in the "${skillName}" skill.`,
    "",
    "Within the team, focus on tasks aligned with your specialty. Coordinate",
    "with peers via team messaging (`hera_team_message`) and use the team shared workspace",
    "(`hera_team_remember` / `hera_team_recall`) to publish decisions, context, and results.",
  ].join("\n");
}

function suggestAvailableMemberAgentName(
  baseName: string,
  registeredAgents: Map<string, AgentDefinition>
): string {
  let suffix = 2;
  let candidate = `${baseName}-${suffix}`;
  while (registeredAgents.has(candidate)) {
    suffix++;
    candidate = `${baseName}-${suffix}`;
  }
  return candidate;
}

export async function upgradeSkillsToTeam(
  args: UpgradeSkillsToTeamArgs
): Promise<UpgradeSkillsToTeamResult> {
  if (args.skillNames.length === 0) {
    return { ok: false, error: "No skills provided.", createdAgents: [] };
  }

  // Validate every skill exists BEFORE creating anything — no partial state.
  const missing: string[] = [];
  for (const name of args.skillNames) {
    if (!args.skillManager.getSkill(name)) missing.push(name);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Skills not found: ${missing.join(", ")}. Use hera_list_skills to inspect available skills.`,
      createdAgents: [],
    };
  }

  const conflictingAgents = args.skillNames
    .map((skillName) => memberAgentNameForSkill(args.teamName, skillName))
    .filter((agentName) => args.registeredAgents.has(agentName));
  if (conflictingAgents.length > 0) {
    const suggestions = conflictingAgents.map(
      (name) => `${name} → ${suggestAvailableMemberAgentName(name, args.registeredAgents)}`
    );
    return {
      ok: false,
      error: `Member agent names already exist: ${conflictingAgents.join(", ")}. Choose a different team name, delete the existing agents first, or use suggested alternatives: ${suggestions.join(", ")}.`,
      createdAgents: [],
    };
  }

  // Create one member agent per skill, persisted via the standard path so
  // built-in skill embedding + .md file + in-memory registration all happen.
  const skillsMap = args.skillManager.getSkillMap();
  const createdAgents: string[] = [];
  const members: TeamMember[] = [];
  const warnings = args.skillNames
    .filter((skillName) => args.skillManager.isBuiltin(skillName))
    .map(
      (skillName) =>
        `Skill "${skillName}" is built in and already inherited by Hera agents; creating a specialist anyway because you requested it.`
    );

  for (const skillName of args.skillNames) {
    const agentName = memberAgentNameForSkill(args.teamName, skillName);
    const role = inferRoleFromSkill(skillName);
    const def: AgentDefinition = {
      name: agentName,
      description: `Team member specializing in ${skillName} for team "${args.teamName}".`,
      mode: args.memberMode ?? "subagent",
      prompt: buildMemberPrompt(skillName, role),
      skills: getDefaultSkills([skillName]),
      maxSteps: DEFAULT_CHILD_MAX_STEPS,
      createdAt: Date.now(),
      evolutionLog: [],
    };
    createdAgents.push(agentName);
    members.push({
      agentName,
      role,
      subscriptions: ["message", "task", "result"],
      backendType: "in-process",
    });
    if (!args.dryRun) {
      await persistAgent(def, skillsMap, args.registeredAgents, args.agentRegistry, args.store);
    }
  }

  const team: TeamDefinition = {
    name: args.teamName,
    description: args.description,
    coordination: args.coordination,
    management: args.management ?? "simple",
    members,
    sharedMemory: [],
    createdAt: Date.now(),
  };
  if (args.dryRun) {
    return {
      ok: true,
      createdAgents,
      team,
      warnings,
      preview: [
        `Preview only: would create team "${args.teamName}" (${team.coordination}, ${team.management}).`,
        `Would create member agents: ${createdAgents.join(", ")}.`,
        `Each member would inherit Hera default skills plus its specialist skill.`,
      ].join("\n"),
    };
  }

  await args.teamManager.createTeam(team);

  return { ok: true, createdAgents, team, warnings };
}
