import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { WorkflowManager } from "./workflow/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { createEngine } from "./engine/index.js";
import { buildActiveWorkContext } from "./engine/active-work.js";
import type { Engine } from "./engine/index.js";
import { createHeraAgent, createChildAgentConfig } from "./agents/hera.js";
import { createAllTools } from "./tools/index.js";
import type { AgentDefinition, HeraConfig, HeraPaths, PluginContext } from "./types.js";
import { DEFAULT_MEMORY_LIMIT, DEFAULT_TEAM_TIMEOUT_MS, getConfigRoot } from "./constants.js";
import { join } from "node:path";
import { heraLog } from "./logger.js";
import { extractMemories } from "./memory/smart-extractor.js";
import { createHash } from "node:crypto";
import { isFirstRun, runOnboarding } from "./onboarding.js";

// Module-level engine reference prevents garbage collection of the running supervisor/loopManager.
let _engine: Engine | undefined;

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

  let heraConfigContent: string | undefined;
  try {
    const { readFile } = await import("node:fs/promises");
    heraConfigContent = await readFile(heraConfigPath, "utf-8");
  } catch (readErr) {
    const code = (readErr as NodeJS.ErrnoException)?.code;
    if (code && code !== "ENOENT") {
      // File exists but is unreadable (EACCES, EISDIR...). Do not overwrite it.
      heraLog("warn", `Could not read hera.json (${code}); using in-memory defaults`, readErr);
    } else {
      // Missing — create the default config.
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
  }

  if (heraConfigContent !== undefined) {
    try {
      const heraConfig = JSON.parse(heraConfigContent);
      config = { ...config, ...heraConfig };
    } catch (parseErr) {
      // File exists but is invalid JSON. Preserve the user's file (a typo must
      // not silently wipe disabled_agents/team_defaults/etc.): back it up and
      // run on defaults this session, leaving the original untouched to fix.
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${heraConfigPath}.bak`, heraConfigContent, "utf-8");
      } catch {
        // best-effort backup
      }
      heraLog(
        "warn",
        `hera.json is invalid JSON — backed up to hera.json.bak and using defaults this session. ` +
          `Your settings are NOT lost; fix the JSON to restore them.`,
        parseErr
      );
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

  try {
    const reconciled = await teamManager.recoverSessions();
    if (reconciled > 0) heraLog("info", `Recovered ${reconciled} team session(s) on startup`);
  } catch (err) {
    heraLog("warn", "Team session recovery failed on startup", err);
  }

  const workflowManager = new WorkflowManager(store, teamManager, client);
  await workflowManager.init();

  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(paths.agentsDir);
  await agentRegistry.init();

  const engine = createEngine({
    dataDir: paths.dataDir,
    cwd: paths.configRoot,
    client,
    config,
    teamManager,
    singleton: true,
  });
  await engine.init();
  await engine.recover();
  engine.start();
  _engine = engine;

  const { taskStore, loopManager, supervisor } = engine;

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
          def.mode as import("./types.js").AgentMode,
          { permission: def.permission, tools: def.tools, maxSteps: def.maxSteps }
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
              // Deterministic content-hash id so re-extraction of an overlapping
              // message window (every compaction re-scans recent messages)
              // overwrites the same entry instead of accumulating duplicates.
              const normalized = memory.content.toLowerCase().replace(/\s+/g, " ").trim();
              const hash = createHash("sha1")
                .update(`${memory.category}:${normalized}`)
                .digest("hex")
                .slice(0, 12);
              await store.save({
                id: `auto-${memory.category}-${hash}`,
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

      // Compaction relay: inject active durable-work context so it survives compaction
      try {
        const activeWorkCtx = await buildActiveWorkContext(engine.taskStore, engine.loopManager);
        if (activeWorkCtx) {
          output.context.push(activeWorkCtx);
        }
      } catch (err) {
        heraLog("warn", "Active-work context relay failed during compaction", err);
      }
    },
  };

  return hooks;
};

function resolveConfigRoot(_projectDir: string): string {
  return getConfigRoot();
}

export default HeraPlugin;
