import type { Plugin, PluginInput, Hooks, Config } from "@opencode-ai/plugin";
import { MemoryStore } from "./memory/store.js";
import { SkillManager, buildSkillManifestSection } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { WorkflowManager } from "./workflow/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { createEngine } from "./engine/index.js";
import { buildActiveWorkContext } from "./engine/active-work.js";
import type { Engine } from "./engine/index.js";
import { createHeraAgent, createChildAgentConfig } from "./agents/hera.js";
import { createAllToolsWithDomains } from "./tools/index.js";
import { ToolCatalog, renderCatalogPrimer } from "./dispatch/catalog.js";
import { createDispatchTools } from "./dispatch/meta-tools.js";
import { buildNativeToolsMap, computeHeraHotSet } from "./dispatch/policy.js";
import { createProgramRunner } from "./program/index.js";
import { migrateLegacyAgentMarkdown } from "./persistence.js";
import type { AgentDefinition, HeraConfig, HeraPaths, PluginContext } from "./types.js";
import {
  DEFAULT_CHILD_NATIVE_TOOLS,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_TEAM_TIMEOUT_MS,
  getConfigRoot,
} from "./constants.js";
import { join } from "node:path";
import { getDefaultSkills } from "./helpers.js";
import { heraLog } from "./logger.js";
import { fetchSessionMessages, saveAutoMemories } from "./memory/session-messages.js";
import { isFirstRun, runOnboarding } from "./onboarding.js";
import { DriveModeStore } from "./mode/store.js";
import { ModeDispatchGuard, applyCommandModeHook, applyChatModeFallback } from "./mode/hooks.js";
import { writeModeCommandFile } from "./mode/install.js";
import { driveModeSystemAddendum } from "./mode/prompt.js";

// Module-level engine reference prevents garbage collection of the running supervisor/loopManager.
let _engine: Engine | undefined;

type ConfigWithAgents = Config & {
  agent?: Record<string, unknown>;
};

type ChatTransformInput = {
  agent?: string;
};

// Current OpenCode passes only a sessionID to the compacting hook; older
// versions passed `messages`. We fetch messages by id via the client.
type CompactingInput = {
  sessionID?: string;
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

  // Each subsystem init is isolated: a single fs hiccup (mkdir EACCES,
  // disk-full, corrupt dir) must not throw out of the plugin factory and leave
  // OpenCode with zero Hera hooks/tools/agents for the whole session. Mirror the
  // defensive pattern above — warn and continue so the other subsystems (and the
  // tool map) still come up.
  const store = new MemoryStore(paths.memoryDir, {
    maxEntries: config.memory_limit ?? DEFAULT_MEMORY_LIMIT,
    ttlMs: config.memory_ttl_ms,
  });
  try {
    await store.init();
  } catch (err) {
    heraLog("warn", "Memory store init failed on startup", err);
  }

  const skillManager = new SkillManager(store, paths.skillsDir);
  try {
    await skillManager.init();
  } catch (err) {
    heraLog("warn", "Skill manager init failed on startup", err);
  }

  const teamManager = new TeamManager(store, client);
  try {
    await teamManager.init();
  } catch (err) {
    heraLog("warn", "Team manager init failed on startup", err);
  }

  try {
    const reconciled = await teamManager.recoverSessions();
    if (reconciled > 0) heraLog("info", `Recovered ${reconciled} team session(s) on startup`);
  } catch (err) {
    heraLog("warn", "Team session recovery failed on startup", err);
  }

  const workflowManager = new WorkflowManager(store, teamManager, client);
  try {
    await workflowManager.init();
  } catch (err) {
    heraLog("warn", "Workflow manager init failed on startup", err);
  }

  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(paths.agentsDir);
  try {
    await agentRegistry.init();
  } catch (err) {
    heraLog("warn", "Agent registry init failed on startup", err);
  }

  const engine = createEngine({
    dataDir: paths.dataDir,
    cwd: paths.configRoot,
    client,
    config,
    teamManager,
    singleton: true,
  });
  try {
    await engine.init();
    await engine.recover();
    engine.start();
  } catch (err) {
    heraLog("warn", "Background engine init/recover failed on startup", err);
  }
  _engine = engine;

  const { taskStore, loopManager, supervisor } = engine;

  // Drive mode: per-session sticky mode (in-memory) + the real ProgramRunner
  // (spawns program-led skills in a child process) + a dispatch guard shared
  // by the two /mode hooks.
  const driveModeStore = new DriveModeStore();
  const programRunner = createProgramRunner({
    client,
    skillManager,
    skillsDir: paths.skillsDir,
    directory,
  });
  const modeGuard = new ModeDispatchGuard();

  // Ensure hera itself has a .md file for OpenCode native discovery
  await agentRegistry.ensureHeraMd(config);

  // Make /mode discoverable in OpenCode's native `/` autocomplete (best-effort).
  await writeModeCommandFile(configRoot);

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

  // One-time idempotent migration (spec §5): rewrite legacy full-body agent
  // .md files to the compact skill-manifest form.
  try {
    await migrateLegacyAgentMarkdown(registeredAgents, skillManager.getSkillMap(), agentRegistry);
  } catch (err) {
    heraLog("warn", "Legacy agent markdown migration failed; continuing", err);
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
    driveModeStore,
    programRunner,
  };

  const { tools: baseTools, domains: toolDomains } = createAllToolsWithDomains(ctx);
  const catalog = new ToolCatalog(baseTools, toolDomains);
  const dispatchTools = createDispatchTools({ catalog, registeredAgents, config });
  // disabled_tools already filtered inside createAllToolsWithDomains; apply the
  // same filter to the meta-tools so users can disable dispatch entirely.
  const disabledToolNames = new Set(config.disabled_tools ?? []);
  const tools = Object.fromEntries(
    Object.entries({ ...baseTools, ...dispatchTools }).filter(([n]) => !disabledToolNames.has(n))
  );

  const heraToolNames = Object.keys(tools).filter((n) => n.startsWith("hera_"));
  // Dispatch is off when either meta-tool was filtered out via disabled_tools.
  // Without dispatch, narrowing native registration would make authorized tools
  // unreachable (spec §2: the hot set is a performance knob only, never an
  // authorization change), and the primer would point at tools that do not
  // exist — so the config hook falls back to legacy full-native registration
  // and skips the primer entirely.
  const dispatchEnabled = "hera_find_tools" in tools && "hera_run_tool" in tools;
  const catalogPrimer = dispatchEnabled ? renderCatalogPrimer(catalog) : "";

  const hooks: Hooks = {
    async config(input: Config) {
      const model = config.default_model ?? input.model ?? "";
      const skills = skillManager.getAllSkills();

      // Inject Hera itself — with its factory-core hot set and the catalog primer.
      const configInput = input as ConfigWithAgents;
      configInput.agent = configInput.agent ?? {};
      const heraCfg = createHeraAgent(model, skills);
      if (dispatchEnabled) {
        heraCfg.prompt = [heraCfg.prompt, catalogPrimer].filter(Boolean).join("\n\n");
        heraCfg.tools = buildNativeToolsMap({
          hotSet: computeHeraHotSet(toolDomains),
          heraToolNames,
        });
      }
      configInput.agent["hera"] = heraCfg;

      // Inject all child agents
      for (const [name, def] of registeredAgents) {
        if (config.disabled_agents?.includes(name)) continue;

        // Per-agent isolation: one corrupt definition (e.g. a bad evolution-log
        // timestamp that makes new Date(...).toISOString() throw RangeError) must
        // not abort injection for the whole roster. Fall back to def.prompt for
        // just that agent and keep going.
        try {
          // Progressive disclosure: compact skill manifest; full bodies load on demand
          // via hera_load_skill. One shared renderer across live/disk/export (spec §5).
          const skillPrompts = buildSkillManifestSection(
            skillManager.skillSummaries(getDefaultSkills(def.skills))
          );

          // Include evolution log if present
          let evolutionBlock = "";
          if (def.evolutionLog && def.evolutionLog.length > 0) {
            const active = def.evolutionLog.filter((e) => !e.rolledBack);
            if (active.length > 0) {
              evolutionBlock =
                "\n\n## Evolved Directives\n\n" +
                active
                  .map(
                    (e, i) => `${i + 1}. [${new Date(e.timestamp).toISOString()}] ${e.directive}`
                  )
                  .join("\n");
            }
          }

          // Per-agent dispatch opt-out: an author's explicit
          // `hera_run_tool: false` in def.tools (the authorization truth)
          // removes the only invocation path for non-native tools, so a
          // narrowed native registration would strand every other authorized
          // tool (spec §2: the hot set is a performance knob only, never an
          // authorization change). Mirror the global dispatch-disabled
          // fallback: keep the author's tools map unchanged so every
          // authorized tool stays natively registered, and skip the primer
          // for this agent.
          const agentDispatch = dispatchEnabled && def.tools?.["hera_run_tool"] !== false;

          const teamBlock = teamManager.getAgentTeamContext(name);
          const fullPrompt = [
            def.prompt,
            skillPrompts,
            teamBlock,
            evolutionBlock,
            agentDispatch ? catalogPrimer : "",
          ]
            .filter((part) => part.trim().length > 0)
            .join("\n\n");

          // "hera" itself is in registeredAgents (its hera.md is on disk), so
          // this loop re-injects it and wins over the dedicated block above —
          // give it its factory-core hot set (spec §2), not the child default.
          const defaultHotSet =
            name === "hera" ? computeHeraHotSet(toolDomains) : [...DEFAULT_CHILD_NATIVE_TOOLS];
          const nativeMap = agentDispatch
            ? buildNativeToolsMap({
                hotSet: def.nativeTools ?? defaultHotSet,
                heraToolNames,
                defTools: def.tools,
              })
            : def.tools;

          const childConfig = createChildAgentConfig(
            name,
            def.description,
            fullPrompt,
            def.model ?? model,
            def.mode as import("./types.js").AgentMode,
            { permission: def.permission, tools: nativeMap, maxSteps: def.maxSteps }
          );
          configInput.agent[name] = childConfig;
        } catch (err) {
          heraLog(
            "warn",
            `Failed to build injected config for agent "${name}"; falling back to base prompt`,
            err
          );
          try {
            configInput.agent[name] = createChildAgentConfig(
              name,
              def.description,
              def.prompt,
              def.model ?? model,
              def.mode as import("./types.js").AgentMode,
              { permission: def.permission, tools: def.tools, maxSteps: def.maxSteps }
            );
          } catch (fallbackErr) {
            heraLog("warn", `Could not inject agent "${name}" at all; skipping`, fallbackErr);
          }
        }
      }
    },

    tool: tools,

    async "command.execute.before"(input, output) {
      await applyCommandModeHook(input, output, {
        store: driveModeStore,
        runner: programRunner,
        guard: modeGuard,
        directory,
      });
    },

    async "chat.message"(input, output) {
      await applyChatModeFallback(input, output, {
        store: driveModeStore,
        runner: programRunner,
        guard: modeGuard,
        directory,
      });
    },

    async "experimental.chat.system.transform"(input, output) {
      // The full team/agent/skill roster is orchestrator context — only Hera
      // should receive it, not each child agent (it bloats every child's prompt
      // and leaks the whole roster to focused workers). Current OpenCode does
      // not pass `agent` on this hook (only sessionID + model), so we cannot
      // always positively identify Hera; we CAN positively identify a child (its
      // name is a registered agent) and skip those. When `agent` is absent we
      // fall back to injecting (Hera's session), preserving live-roster
      // awareness; when a future runtime passes `agent`, children are excluded.
      const agent = (input as ChatTransformInput).agent;
      // "hera" is itself present in registeredAgents (its hera.md is on disk), so
      // exclude it from the child check — only OTHER registered agents are the
      // focused children we must not inject the roster into.
      const isRegisteredChild =
        typeof agent === "string" && agent !== "hera" && registeredAgents.has(agent);
      if (!isRegisteredChild && (agent === "hera" || agent === undefined)) {
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

        // Drive-mode addendum (Hera only). collab -> null (byte-identical to
        // today); auto -> the autonomy directive; program -> null. A missing
        // sessionID is treated as collab (safe default).
        const driveMode = driveModeStore.get(input.sessionID ?? "");
        const addendum = driveModeSystemAddendum(driveMode, {
          sessionID: input.sessionID ?? "",
          directory,
        });
        if (addendum) output.system.push(addendum);
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

      // Auto-memory extraction. The hook input only carries a sessionID on
      // current OpenCode, so fetch the messages by id via the client rather than
      // reading a (no-longer-present) input.messages field.
      if (config.auto_memory === true) {
        try {
          const sessionID = (input as CompactingInput).sessionID;
          const messages = await fetchSessionMessages(client, sessionID);
          const saved = await saveAutoMemories(store, messages);
          if (saved > 0) {
            heraLog("info", `Auto-memory: extracted ${saved} memories from session compaction`);
          }
        } catch (err) {
          // A genuine failure (client/store error) is surfaced at warn — an
          // earlier regression made auto-memory silently dead, so a real
          // failure must not be invisible at the default log level.
          heraLog("warn", "Auto-memory extraction failed during compaction", err);
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
