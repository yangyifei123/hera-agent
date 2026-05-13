import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { createHeraAgent, createChildAgentConfig } from "./agents/hera.js";
import { createAllTools } from "./tools/index.js";
import { join } from "node:path";
import type { AgentDefinition, HeraConfig, HeraPaths, PluginContext } from "./types.js";

const HeraPlugin: Plugin = async (input: PluginInput, options?: Record<string, unknown>) => {
  const { client, project, directory } = input;

  const configRoot = resolveConfigRoot(directory);

  // Auto-initialize hera.json on first load
  const heraConfigPath = join(configRoot, "hera.json");
  let config = (options ?? {}) as HeraConfig;

  try {
    const { readFile } = await import("node:fs/promises");
    const heraConfigContent = await readFile(heraConfigPath, "utf-8");
    const heraConfig = JSON.parse(heraConfigContent);
    config = { ...config, ...heraConfig };
  } catch {
    // hera.json doesn't exist, create it automatically
    try {
      const { writeFile } = await import("node:fs/promises");
      // Use relative path for schema to avoid network dependency in internal networks
      const defaultConfig = {
        "$schema": "./hera.schema.json",
        "disabled_agents": [],
        "disabled_skills": [],
        "disabled_tools": [],
        "agent_overrides": {},
        "templates": {},
        "auto_evolve": false,
        "memory_limit": 1000,
        "team_defaults": {
          "coordination": "parallel",
          "timeout": 300000
        }
      };
      await writeFile(heraConfigPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
      console.log(`[Hera] Created config file: ${heraConfigPath}`);
    } catch (err) {
      console.warn(`[Hera] Could not create config file: ${err}`);
    }
  }

  const paths: HeraPaths = {
    configRoot,
    dataDir: join(configRoot, "hera-data"),
    memoryDir: join(configRoot, "hera-data", "memory"),
    skillsDir: join(configRoot, "hera-data", "skills"),
    agentsDir: join(configRoot, "agents", "hera"),
  };

  const store = new MemoryStore(paths.memoryDir);
  await store.init();

  const skillManager = new SkillManager(store, paths.skillsDir);
  await skillManager.init();

  const teamManager = new TeamManager(store, client);
  await teamManager.init();

  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(paths.agentsDir);
  await agentRegistry.init();

  // Ensure hera itself has a .md file for OpenCode native discovery
  await agentRegistry.ensureHeraMd(config);

  const registeredAgents = new Map<string, AgentDefinition>();

  // Load persisted agents from disk
  const diskAgentNames = await agentRegistry.listRegistered();
  for (const name of diskAgentNames) {
    const def = await agentRegistry.readDefinition(name);
    if (def) registeredAgents.set(name, def);
  }

  // Fill gaps from memory store
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

  const ctx: PluginContext = {
    store,
    skillManager,
    teamManager,
    distillation,
    agentRegistry,
    registeredAgents,
    client,
    config,
    paths,
  };

  const tools = createAllTools(ctx);

  const hooks: Hooks = {
    async config(input: Config) {
      const model = config.default_model ?? input.model;
      const skills = skillManager.getAllSkills();

      // Inject Hera itself
      const heraAgent = createHeraAgent(model, skills);
      (input as any).agent = (input as any).agent ?? {};
      (input as any).agent["hera"] = heraAgent;

      // Inject all child agents
      for (const [name, def] of registeredAgents) {
        if (config.disabled_agents?.includes(name)) continue;

        const childSkills = def.skills
          .map((sn) => skillManager.getSkill(sn))
          .filter(Boolean);

        const skillPrompts = childSkills.map((s) => `## Skill: ${s!.name}\n${s!.prompt}`).join("\n\n");

        // Include evolution log if present
        let evolutionBlock = "";
        if (def.evolutionLog && def.evolutionLog.length > 0) {
          const active = def.evolutionLog.filter((e) => !e.rolledBack);
          if (active.length > 0) {
            evolutionBlock = "\n\n## Evolved Directives\n\n" +
              active.map((e, i) => `${i + 1}. [${new Date(e.timestamp).toISOString()}] ${e.directive}`).join("\n");
          }
        }

        const fullPrompt = `${def.prompt}\n\n${skillPrompts}${evolutionBlock}`;

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

    tool: tools,

    async "experimental.chat.system.transform"(input, output) {
      const agent = (input as any).agent;
      if (agent === "hera" || agent === undefined) {
        const teams = teamManager.getAllTeams();
        if (teams.length > 0) {
          const teamContext = teams.map((t) => teamManager.buildTeamContext(t.name)).join("\n\n");
          output.system.push(`\n## Active Teams\n\n${teamContext}`);
        }

        const agents = Array.from(registeredAgents.entries());
        if (agents.length > 0) {
          const agentList = agents
            .map(([n, d]) => `- **@${n}**: ${d.description} [${d.mode}]${d.template ? ` template:${d.template}` : ""}`)
            .join("\n");
          output.system.push(`\n## Registered Agents\n\n${agentList}`);
        }

        const skills = skillManager.getAllSkills();
        const skillList = skills.map((s) => `- **${s.name}** (${s.category}): ${s.description}`).join("\n");
        output.system.push(`\n## Available Skills\n\n${skillList}`);
      }
    },

    async "experimental.session.compacting"(input, output) {
      output.context.push("Hera Session Context: Distill key decisions, patterns, and skills before compaction. Recall relevant memories.");
    },
  };

  return hooks;
};

function resolveConfigRoot(projectDir: string): string {
  if (process.platform === "win32") {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "C:/Users/Administrator";
    return join(home, ".config", "opencode");
  }
  const home = process.env.HOME ?? "/root";
  return join(home, ".config", "opencode");
}

export default HeraPlugin;
