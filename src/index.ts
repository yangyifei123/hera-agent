// Hera Plugin — Main entry point
//
// Architecture:
// 1. On load, reads persisted agents from ~/.config/opencode/agents/hera/*.md
// 2. config hook injects Hera + all child agents into opencode's agent registry
// 3. Tools can create new agents (written to disk for restart persistence)
// 4. Teams use client.session API to spawn real OpenCode sessions

import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { createHeraAgent, createChildAgentConfig } from "./agents/hera.js";
import { createHeraTools } from "./tools/hera-tools.js";
import { join } from "node:path";
import type { AgentDefinition, HeraConfig, HeraPaths } from "./types.js";

const HeraPlugin: Plugin = async (input: PluginInput, options?: Record<string, unknown>) => {
  const { client, project, directory } = input;
  const config = (options ?? {}) as HeraConfig;

  // === Resolve paths ===
  // Walk up from directory to find opencode config root, or use known path
  const configRoot = resolveConfigRoot(directory);
  const paths: HeraPaths = {
    configRoot,
    dataDir: join(configRoot, "hera-data"),
    memoryDir: join(configRoot, "hera-data", "memory"),
    skillsDir: join(configRoot, "hera-data", "skills"),
    agentsDir: join(configRoot, "agents", "hera"),
  };

  // === Initialize subsystems ===
  const store = new MemoryStore(paths.memoryDir);
  await store.init();

  const skillManager = new SkillManager(store, paths.skillsDir);
  await skillManager.init();

  const teamManager = new TeamManager(store, client);
  await teamManager.init();

  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(paths.agentsDir);
  await agentRegistry.init();

  // === Load persisted agents ===
  const registeredAgents = new Map<string, AgentDefinition>();

  // 1. From disk (agents/hera/*.md — survives restarts)
  const diskAgentNames = await agentRegistry.listRegistered();
  for (const name of diskAgentNames) {
    const def = await agentRegistry.readDefinition(name);
    if (def) registeredAgents.set(name, def);
  }

  // 2. From memory store (backup source)
  const storedAgents = await store.list("agent");
  for (const mem of storedAgents) {
    try {
      const agent = JSON.parse(mem.content) as AgentDefinition;
      if (!registeredAgents.has(agent.name)) {
        registeredAgents.set(agent.name, agent);
      }
    } catch {
      // skip
    }
  }

  // === Create tools ===
  const tools = createHeraTools({
    skillManager,
    teamManager,
    distillation,
    memoryStore: store,
    agentRegistry,
    config,
    registeredAgents,
    client,
  });

  // === Hooks ===
  const hooks: Hooks = {
    /**
     * config hook — inject agents into opencode's agent registry.
     * Called on every startup. This is the KEY to making agents appear
     * in `opencode list agent` and be usable with `opencode --agent <name>`.
     */
    async config(input: Config) {
      const model = config.default_model ?? input.model ?? "cherry/GLM-5";
      const skills = skillManager.getAllSkills();

      // Inject Hera itself
      const heraAgent = createHeraAgent(model, skills);
      (input as any).agent = (input as any).agent ?? {};
      (input as any).agent["hera"] = heraAgent;

      // Inject all child agents from registeredAgents
      for (const [name, def] of registeredAgents) {
        if (config.disabled_agents?.includes(name)) continue;

        // Build child agent config with embedded skills
        const childSkills = def.skills
          .map((sn) => skillManager.getSkill(sn))
          .filter(Boolean);

        // Combine prompt with skill prompts
        const skillPrompts = childSkills.map((s) => `## Skill: ${s!.name}\n${s!.prompt}`).join("\n\n");
        const fullPrompt = `${def.prompt}\n\n${skillPrompts}`;

        const childConfig = createChildAgentConfig(
          name,
          def.description,
          fullPrompt,
          def.model ?? model,
          def.mode as import("./types.js").AgentMode
        );
        (input as any).agent[name] = childConfig;
      }
    },

    // Register custom tools
    tool: tools,

    // Inject dynamic context into Hera's system prompt
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

    // Distillation hint on compaction
    async "experimental.session.compacting"(input, output) {
      output.context.push(
        "Hera Session Context: Distill key decisions, patterns, and skills before compaction."
      );
    },
  };

  return hooks;
};

/**
 * Resolve the opencode config root directory.
 * Usually ~/.config/opencode/
 */
function resolveConfigRoot(projectDir: string): string {
  // On Windows, use the known path
  if (process.platform === "win32") {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "C:/Users/Administrator";
    return join(home, ".config", "opencode");
  }
  // Unix
  const home = process.env.HOME ?? "/root";
  return join(home, ".config", "opencode");
}

export default HeraPlugin;
