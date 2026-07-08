import type { PluginContext } from "../types.js";
import { createAgentTools } from "./agent-tools.js";
import { createSkillTools } from "./skill-tools.js";
import { createTeamTools } from "./team-tools.js";
import { createMemoryTools } from "./memory-tools.js";
import { createEvolutionTools } from "./evolution-tools.js";
import { createSystemTools } from "./system-tools.js";
import { createPackageTools } from "./package-tools.js";
import { createWorkflowTools } from "./workflow-tools.js";
import { createTaskTools } from "./task-tools.js";
import { createLoopTools } from "./loop-tools.js";
import { createRecoveryTools } from "./recovery-tools.js";
import { createProgramTools } from "./program-tools.js";
import { createProgramScaffoldTools } from "./program-scaffold-tools.js";

export function createAllTools(ctx: PluginContext) {
  const tools = {
    ...createAgentTools(ctx),
    ...createSkillTools(ctx),
    ...createTeamTools(ctx),
    ...createMemoryTools(ctx),
    ...createEvolutionTools(ctx),
    ...createSystemTools(ctx),
    ...createPackageTools(ctx),
    ...createWorkflowTools(ctx),
    ...createTaskTools(ctx),
    ...createLoopTools(ctx),
    ...createRecoveryTools(ctx),
    ...createProgramTools(ctx),
    ...createProgramScaffoldTools(ctx),
  };
  const disabled = new Set(ctx.config.disabled_tools ?? []);
  if (disabled.size === 0) return tools;
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !disabled.has(name)));
}
