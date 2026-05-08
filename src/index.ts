// Hera Plugin - Main entry point

import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { createHeraAgent } from "./agents/hera.js";
import { createHeraTools } from "./tools/hera-tools.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition, HeraConfig } from "./types.js";

const HeraPlugin: Plugin = async (input: PluginInput, options?: Record<string, unknown>) => {
  const { client, project, directory } = input;
  const config = (options ?? {}) as HeraConfig;

  // Initialize subsystems
  const heraDir = join(directory, ".hera");
  const store = new MemoryStore(heraDir);
  await store.init();

  const skillManager = new SkillManager(store, join(heraDir, "skills"));
  await skillManager.init();

  const teamManager = new TeamManager(store);
  await teamManager.init();

  const distillation = new DistillationEngine(store);

  // Track registered agents
  const registeredAgents = new Map<string, AgentDefinition>();

  // Load previously created agents from memory
  const storedAgents = await store.list("agent");
  for (const mem of storedAgents) {
    try {
      const agent = JSON.parse(mem.content) as AgentDefinition;
      registeredAgents.set(agent.name, agent);
    } catch {
      // Skip malformed
    }
  }

  // Create Hera's tools
  const tools = createHeraTools({
    skillManager,
    teamManager,
    distillation,
    memoryStore: store,
    config,
    registeredAgents,
  });

  // The Hooks object
  const hooks: Hooks = {
    // Inject agents into opencode's config
    async config(input: Config) {
      const model = config.default_model ?? input.model ?? "cherry/GLM-5";
      const skills = skillManager.getAllSkills();

      // Register Hera as primary agent
      const heraAgent = createHeraAgent(model, skills);
      (input as any).agent = (input as any).agent ?? {};
      (input as any).agent["hera"] = heraAgent;

      // Register all child agents
      for (const [name, def] of registeredAgents) {
        const { createChildAgent } = await import("./agents/hera.js");
        const childSkills = def.skills
          .map((sn) => skillManager.getSkill(sn))
          .filter(Boolean) as import("./types.js").SkillDefinition[];

        const childAgent = createChildAgent(
          name,
          def.model ?? model,
          def.prompt,
          childSkills,
          def.mode as import("./types.js").AgentMode
        );
        (input as any).agent[name] = childAgent;
      }
    },

    // Register Hera's custom tools
    tool: tools,

    // Modify system prompt to include Hera context
    async "experimental.chat.system.transform"(input, output) {
      const agent = (input as any).agent;
      if (agent === "hera" || agent === undefined) {
        const teams = teamManager.getAllTeams();
        if (teams.length > 0) {
          const teamContext = teams
            .map((t) => teamManager.buildTeamContext(t.name))
            .join("\n\n");
          output.system.push(`\n## Active Teams\n\n${teamContext}`);
        }

        const agents = Array.from(registeredAgents.entries());
        if (agents.length > 0) {
          const agentList = agents
            .map(([n, d]) => `- **@${n}**: ${d.description} [${d.mode}]`)
            .join("\n");
          output.system.push(`\n## Registered Agents\n\n${agentList}`);
        }
      }
    },

    // Handle session distillation on compaction
    async "experimental.session.compacting"(input, output) {
      output.context.push(
        "Hera Session Context: Distill key decisions, patterns, and skills before compaction."
      );
    },
  };

  return hooks;
};

export default HeraPlugin;
