/**
 * Team Templates
 * Pre-defined team configurations for common workflows.
 * Used by hera_quick_team for one-command team creation.
 */

import type { TeamManagementMode } from "../constants.js";
import type { AgentTemplateName } from "../types.js";

export interface TeamTemplateMember {
  role: string;
  template: AgentTemplateName;
}

export interface TeamTemplate {
  description: string;
  members: TeamTemplateMember[];
  coordination: "parallel" | "sequential" | "adaptive";
  management?: TeamManagementMode;
}

export const TEAM_TEMPLATES = {
  "code-review": {
    description: "Code review team with reviewer and bug hunter",
    members: [
      { role: "reviewer", template: "reviewer" as AgentTemplateName },
      { role: "bug-hunter", template: "debugger" as AgentTemplateName },
    ],
    coordination: "parallel" as const,
    management: "control" as const,
  },
  "dev-pipeline": {
    description: "Development pipeline: architect → coder → tester",
    members: [
      { role: "architect", template: "architect" as AgentTemplateName },
      { role: "coder", template: "coder" as AgentTemplateName },
      { role: "tester", template: "tester" as AgentTemplateName },
    ],
    coordination: "sequential" as const,
    management: "okr" as const,
  },
  research: {
    description: "Research team: researcher → writer",
    members: [
      { role: "researcher", template: "researcher" as AgentTemplateName },
      { role: "writer", template: "documenter" as AgentTemplateName },
    ],
    coordination: "sequential" as const,
    management: "tree" as const,
  },
} satisfies Record<string, TeamTemplate>;

export type TeamTemplateName = keyof typeof TEAM_TEMPLATES;

/**
 * Get a team template by name.
 */
export function getTeamTemplate(name: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES[name as TeamTemplateName];
}

/**
 * Get all available team template names.
 */
export function getTeamTemplateNames(): string[] {
  return Object.keys(TEAM_TEMPLATES);
}
