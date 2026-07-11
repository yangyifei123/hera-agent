import type { PluginContext } from "../types.js";
import type { ToolDefinition } from "@opencode-ai/plugin";
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
import { createCommandTools } from "./command-tools.js";

const DOMAIN_FACTORIES: ReadonlyArray<
  readonly [string, (ctx: PluginContext) => Record<string, ToolDefinition>]
> = [
  ["agent", createAgentTools],
  ["skill", createSkillTools],
  ["team", createTeamTools],
  ["memory", createMemoryTools],
  ["evolution", createEvolutionTools],
  ["system", createSystemTools],
  ["package", createPackageTools],
  ["workflow", createWorkflowTools],
  ["task", createTaskTools],
  ["loop", createLoopTools],
  ["recovery", createRecoveryTools],
  ["program", createProgramTools],
  ["program-scaffold", createProgramScaffoldTools],
  ["command", createCommandTools],
];

/**
 * Merge all tool domains, preserving which domain each tool came from.
 * `domains` maps tool name -> domain slug; used by the dispatch catalog
 * (src/dispatch/) and the per-agent native-set computation.
 */
export function createAllToolsWithDomains(ctx: PluginContext): {
  tools: Record<string, ToolDefinition>;
  domains: Record<string, string>;
} {
  const tools: Record<string, ToolDefinition> = {};
  const domains: Record<string, string> = {};
  for (const [domain, factory] of DOMAIN_FACTORIES) {
    for (const [name, def] of Object.entries(factory(ctx))) {
      tools[name] = def;
      domains[name] = domain;
    }
  }
  const disabled = new Set(ctx.config.disabled_tools ?? []);
  if (disabled.size > 0) {
    for (const name of Object.keys(tools)) {
      if (disabled.has(name)) {
        delete tools[name];
        delete domains[name];
      }
    }
  }
  return { tools, domains };
}

export function createAllTools(ctx: PluginContext): Record<string, ToolDefinition> {
  return createAllToolsWithDomains(ctx).tools;
}
