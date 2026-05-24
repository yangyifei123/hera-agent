/**
 * Team Templates
 * Pre-defined team configurations for common workflows.
 * Used by hera_quick_team for one-command team creation.
 */

import type { TeamManagementMode } from "../constants.js";
import type { AgentTemplateName } from "../types.js";
import type { TeamWorkflowRecipe } from "../types.js";

export interface TeamTemplateMember {
  role: string;
  template: AgentTemplateName;
}

export interface TeamTemplate {
  description: string;
  members: TeamTemplateMember[];
  coordination: "parallel" | "sequential" | "adaptive";
  management?: TeamManagementMode;
  workflow?: TeamWorkflowRecipe;
}

function recipe(
  id: string,
  name: string,
  description: string,
  steps: TeamWorkflowRecipe["steps"]
): TeamWorkflowRecipe {
  return { id, name, description, mode: "recipe", steps };
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
    workflow: recipe(
      "code-review-workflow",
      "Code Review Recipe",
      "Parallel review recipe for style, security, and logic",
      [
        { id: "step-1", type: "agent", title: "Review style", actor: "reviewer" },
        { id: "step-2", type: "agent", title: "Check security", actor: "bug-hunter" },
        { id: "step-3", type: "approval", title: "Approve result" },
      ]
    ),
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
    workflow: recipe(
      "dev-pipeline-workflow",
      "Dev Pipeline Recipe",
      "Simple dev pipeline recipe for build-test-review",
      [
        { id: "step-1", type: "agent", title: "Plan changes", actor: "architect" },
        {
          id: "step-2",
          type: "agent",
          title: "Implement changes",
          actor: "coder",
          dependsOn: ["step-1"],
        },
        { id: "step-3", type: "tool", title: "Run tests", actor: "tester", dependsOn: ["step-2"] },
        { id: "step-4", type: "approval", title: "Request approval", dependsOn: ["step-3"] },
      ]
    ),
  },
  research: {
    description: "Research team: researcher → writer",
    members: [
      { role: "researcher", template: "researcher" as AgentTemplateName },
      { role: "writer", template: "documenter" as AgentTemplateName },
    ],
    coordination: "sequential" as const,
    management: "tree" as const,
    workflow: recipe(
      "research-workflow",
      "Research Recipe",
      "Research recipe for gather-analyze-write",
      [
        { id: "step-1", type: "agent", title: "Gather sources", actor: "researcher" },
        {
          id: "step-2",
          type: "message",
          title: "Hand off findings",
          actor: "writer",
          dependsOn: ["step-1"],
        },
        { id: "step-3", type: "approval", title: "Approve draft", dependsOn: ["step-2"] },
      ]
    ),
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
