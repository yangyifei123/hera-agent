import type { PluginContext } from "../types.js";
import { createAgentTools } from "./agent-tools.js";
import { createSkillTools } from "./skill-tools.js";
import { createTeamTools } from "./team-tools.js";
import { createMemoryTools } from "./memory-tools.js";
import { createEvolutionTools } from "./evolution-tools.js";
import { createSystemTools } from "./system-tools.js";
import { createPackageTools } from "./package-tools.js";
import { createWorkflowTools } from "./workflow-tools.js";

export function createAllTools(ctx: PluginContext) {
  return {
    ...createAgentTools(ctx),
    ...createSkillTools(ctx),
    ...createTeamTools(ctx),
    ...createMemoryTools(ctx),
    ...createEvolutionTools(ctx),
    ...createSystemTools(ctx),
    ...createPackageTools(ctx),
    ...createWorkflowTools(ctx),
  };
}
