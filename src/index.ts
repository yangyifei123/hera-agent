import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { WorkflowManager } from "./workflow/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { TaskStore } from "./engine/task-store.js";
import { LoopStore } from "./engine/loop-store.js";
import { LoopManager } from "./engine/loop-manager.js";
import { AcceptanceEvaluator } from "./engine/acceptance.js";
import { TaskExecutor } from "./engine/executor.js";
import { Supervisor } from "./engine/supervisor.js";
import { OpenCodeAgentRunner } from "./engine/opencode-agent-runner.js";
import { createHeraAgent, createChildAgentConfig } from "./agents/hera.js";
import { createAllTools } from "./tools/index.js";
import type { AgentDefinition, HeraConfig, HeraPaths, PluginContext } from "./types.js";
import {
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_TEAM_TIMEOUT_MS,
  getConfigRoot,
  TASK_CONCURRENCY,
  TASK_LEASE_MS,
  SUPERVISOR_TICK_MS,
  LOOP_TICK_MS,
  LOOP_DEFAULT_MAX_ITERATIONS,
  LOOP_MIN_INTERVAL_MS,
  LOOP_MAX_CONSECUTIVE_FAILURES,
} from "./constants.js";
import { getDefaultPermission } from "./helpers.js";
import { join } from "node:path";
import { heraLog } from "./logger.js";
import { extractMemories } from "./memory/smart-extractor.js";
import { randomUUID } from "node:crypto";
import { isFirstRun, runOnboarding } from "./onboarding.js";

// Module-level supervisor reference prevents garbage collection of the running supervisor.
let _supervisor: Supervisor | undefined;
// Module-level loop manager reference prevents garbage collection.
let _loopManager: LoopManager | undefined;

type ConfigWithAgents = Config & {
  agent?: Record<string, unknown>;
};

type ChatTransformInput = {
  agent?: string;
};

type CompactingInput = {
  messages?: Array<{ role: string; content: string }>;
};

const HeraPlugin: Plugin = async (input: PluginInput, options?: Record<string, unknown>) => {
  const { client, directory } = input;

  const configRoot = resolveConfigRoot(directory);

  // Ensure configRoot exists before any file operation — covers fresh
  // installs where ~/.config/opencode hasn't been created yet.
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(configRoot, { recursive: true });
  } catch (err) {
    heraLog("warn", `Could not create config root ${configRoot}`, err);
  }

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
        $schema: "./hera.schema.json",
        disabled_agents: [],
        disabled_skills: [],
        disabled_tools: [],
        agent_overrides: {},
        templates: {},
        auto_evolve: false,
        auto_memory: false,
        memory_limit: DEFAULT_MEMORY_LIMIT,
        memory_ttl_ms: 0,
        team_defaults: {
          coordination: "parallel",
          timeout: DEFAULT_TEAM_TIMEOUT_MS,
        },
      };
      await writeFile(heraConfigPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
      heraLog("info", `Created config file: ${heraConfigPath}`);
    } catch (err) {
      heraLog("warn", `Could not create config file`, err);
    }
  }

  const paths: HeraPaths = {
    configRoot,
    dataDir: join(configRoot, "hera-data"),
    memoryDir: join(configRoot, "hera-data", "memory"),
    skillsDir: join(configRoot, "hera-data", "skills"),
    agentsDir: join(configRoot, "agents", "hera"),
  };

  const store = new MemoryStore(paths.memoryDir, {
    maxEntries: config.memory_limit ?? DEFAULT_MEMORY_LIMIT,
    ttlMs: config.memory_ttl_ms,
  });
  await store.init();

  const skillManager = new SkillManager(store, paths.skillsDir);
  await skillManager.init();

  const teamManager = new TeamManager(store, client);
  await teamManager.init();

  const workflowManager = new WorkflowManager(store, teamManager, client);
  await workflowManager.init();

  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(paths.agentsDir);
  await agentRegistry.init();

  const taskStore = new TaskStore(paths.dataDir);
  await taskStore.init();

  // Wire the task engine: AcceptanceEvaluator, runner, executor, supervisor
  const bashPerm = getDefaultPermission()?.bash;
  const acceptance = new AcceptanceEvaluator({
    shellEnabled: bashPerm !== "deny",
    defaultTimeoutMs: TASK_LEASE_MS,
  });
  const agentRunner = new OpenCodeAgentRunner(client, paths.configRoot);
  const taskExecutor = new TaskExecutor(taskStore, acceptance, agentRunner, paths.configRoot);
  const supervisor = new Supervisor(taskStore, taskExecutor, {
    concurrency: config.task_concurrency ?? TASK_CONCURRENCY,
    leaseMs: config.task_lease_ms ?? TASK_LEASE_MS,
    tickMs: SUPERVISOR_TICK_MS,
    ownerId: randomUUID(),
  });
  await supervisor.recover();
  supervisor.start();
  _supervisor = supervisor;

  const loopStore = new LoopStore(paths.dataDir);
  await loopStore.init();
  const loopManager = new LoopManager(loopStore, taskStore, acceptance, paths.configRoot, {
    tickMs: config.loop_tick_ms ?? LOOP_TICK_MS,
    defaultMaxIterations: config.loop_default_max_iterations ?? LOOP_DEFAULT_MAX_ITERATIONS,
    minIntervalMs: config.loop_min_interval_ms ?? LOOP_MIN_INTERVAL_MS,
    maxConsecutiveFailures: config.loop_max_consecutive_failures ?? LOOP_MAX_CONSECUTIVE_FAILURES,
  });
  await loopManager.recover();
  loopManager.start();
  _loopManager = loopManager;

  // Ensure hera itself has a .md file for OpenCode native discovery
  await agentRegistry.ensureHeraMd(config);

  // First-run onboarding: create default agents and team
  if (isFirstRun(paths)) {
    await runOnboarding(paths, agentRegistry, teamManager, store, skillManager);
  }

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
      heraLog("debug", `Failed to parse stored agent definition`);
    }
  }

  const ctx: PluginContext = {
    store,
    skillManager,
    teamManager,
    workflowManager,
    distillation,
    agentRegistry,
    registeredAgents,
    client,
    taskStore,
    loopManager,
    supervisor,
    config,
    paths,
    autoEvolve: config.auto_evolve === true,
  };

  const tools = createAllTools(ctx);

  const hooks: Hooks = {
    async config(input: Config) {
      const model = config.default_model ?? input.model ?? "";
      const skills = skillManager.getAllSkills();

      // Inject Hera itself
      const configInput = input as ConfigWithAgents;
      configInput.agent = configInput.agent ?? {};
      configInput.agent["hera"] = createHeraAgent(model, skills);

      // Inject all child agents
      for (const [name, def] of registeredAgents) {
        if (config.disabled_agents?.includes(name)) continue;

        const childSkills = def.skills
          .map((sn) => skillManager.getSkill(sn))
          .filter((skill): skill is NonNullable<typeof skill> => skill !== undefined);

        const skillPrompts = childSkills
          .map((s) => `## Skill: ${s.name}\n${s.prompt}`)
          .join("\n\n");

        // Include evolution log if present
        let evolutionBlock = "";
        if (def.evolutionLog && def.evolutionLog.length > 0) {
          const active = def.evolutionLog.filter((e) => !e.rolledBack);
          if (active.length > 0) {
            evolutionBlock =
              "\n\n## Evolved Directives\n\n" +
              active
                .map((e, i) => `${i + 1}. [${new Date(e.timestamp).toISOString()}] ${e.directive}`)
                .join("\n");
          }
        }

        const teamBlock = teamManager.getAgentTeamContext(name);
        const fullPrompt = [def.prompt, skillPrompts, teamBlock, evolutionBlock]
          .filter((part) => part.trim().length > 0)
          .join("\n\n");

        const childConfig = createChildAgentConfig(
          name,
          def.description,
          fullPrompt,
          def.model ?? model,
          def.mode as import("./types.js").AgentMode
        );
        configInput.agent[name] = childConfig;
      }
    },

    tool: tools,

    async "experimental.chat.system.transform"(input, output) {
      const agent = (input as ChatTransformInput).agent;
      if (agent === "hera" || agent === undefined) {
        const teams = teamManager.getAllTeams();
        if (teams.length > 0) {
          const teamContext = teams.map((t) => teamManager.buildTeamContext(t.name)).join("\n\n");
          output.system.push(`\n## Active Teams\n\n${teamContext}`);
        }

        const agents = Array.from(registeredAgents.entries());
        if (agents.length > 0) {
          const agentList = agents
            .map(
              ([n, d]) =>
                `- **@${n}**: ${d.description} [${d.mode}]${d.template ? ` template:${d.template}` : ""}`
            )
            .join("\n");
          output.system.push(`\n## Registered Agents\n\n${agentList}`);
        }

        const skills = skillManager.getAllSkills();
        const skillList = skills
          .map((s) => `- **${s.name}** (${s.category}): ${s.description}`)
          .join("\n");
        output.system.push(`\n## Available Skills\n\n${skillList}`);
      }
    },

    async "experimental.session.compacting"(input, output) {
      output.context.push(
        "Hera Session Context: Distill key decisions, patterns, and skills before compaction. Recall relevant memories."
      );
      if (ctx.autoEvolve) {
        output.context.push(
          "Reflect on this session's failures and propose evolution directives if needed. Use hera_evolve_agent to suggest improvements. If you encountered failures, describe them and I'll propose evolution directives via hera_propose_evolution."
        );
      }

      // Auto-memory extraction
      if (config.auto_memory === true) {
        try {
          const messages = (input as CompactingInput).messages;
          if (messages && messages.length > 0) {
            const extracted = extractMemories(messages);
            for (const memory of extracted) {
              await store.save({
                id: `auto-${memory.category}-${randomUUID().slice(0, 8)}`,
                type: memory.category,
                content: memory.content,
                timestamp: Date.now(),
                metadata: { source: "auto-memory", confidence: memory.confidence },
              });
            }
            if (extracted.length > 0) {
              heraLog(
                "debug",
                `Auto-memory: extracted ${extracted.length} memories from session compaction`
              );
            }
          }
        } catch (err) {
          heraLog("debug", "Auto-memory extraction failed during compaction", err);
        }
      }
    },
  };

  return hooks;
};

function resolveConfigRoot(_projectDir: string): string {
  return getConfigRoot();
}

export default HeraPlugin;
