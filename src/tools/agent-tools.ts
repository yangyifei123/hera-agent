import { tool } from "@opencode-ai/plugin";
import type { PluginContext, AgentDefinition, AgentTemplateName, AgentMode } from "../types.js";
import { DEFAULT_CHILD_MAX_STEPS } from "../constants.js";
import { getDefaultSkills } from "../helpers.js";
import { persistAgent, removeAgent } from "../persistence.js";
import { createAgentFromTemplate } from "../agents/hera.js";
import { validateAgentNameWithConflict } from "../validation.js";
import { heraLog } from "../logger.js";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

const z = tool.schema;

// === Quickstart Pure Helpers (exported for testing) ===

const PURPOSE_KEYWORD_MAP: Array<{ keywords: string[]; template: AgentTemplateName }> = [
  // More specific keywords first to avoid "build" matching coder before "build" meaning architecture
  { keywords: ["review", "audit", "check", "inspect"], template: "reviewer" },
  { keywords: ["test", "qa", "quality", "verify", "validate"], template: "tester" },
  { keywords: ["document", "write docs", "explain", "readme"], template: "documenter" },
  { keywords: ["optimize", "performance", "speed", "fast", "efficient"], template: "optimizer" },
  { keywords: ["debug", "fix", "troubleshoot", "diagnose"], template: "debugger" },
  { keywords: ["design", "architecture", "architect", "plan", "blueprint"], template: "architect" },
  { keywords: ["coordinate", "manage", "organize", "orchestrate"], template: "coordinator" },
  { keywords: ["research", "investigate", "find", "search", "analyze"], template: "researcher" },
  { keywords: ["code", "program", "develop", "implement", "build"], template: "coder" },
];

const SUBAGENT_TEMPLATES: AgentTemplateName[] = ["reviewer", "tester", "documenter", "optimizer"];

/** Suggest a template based on the purpose description */
export function suggestTemplate(purpose: string): AgentTemplateName {
  const lower = purpose.toLowerCase();
  for (const { keywords, template } of PURPOSE_KEYWORD_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return template;
    }
  }
  return "general";
}

/** Suggest agent mode based on template */
export function suggestMode(template: AgentTemplateName): AgentMode {
  return SUBAGENT_TEMPLATES.includes(template) ? "subagent" : "all";
}

/** Convert purpose text to a slug-safe agent name */
export function slugifyName(purpose: string): string {
  // Split camelCase before lowercasing
  let slug = purpose
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase split
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Ensure starts with letter
  if (!slug || !/^[a-z]/.test(slug)) {
    slug = slug ? "agent-" + slug : "agent";
  }

  return slug.slice(0, 50);
}

/** Find an available name, appending numbers if needed */
export function findAvailableName(base: string, existing: Map<string, unknown>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * Lazy-load the plugin-generator module so its cost is only paid when a
 * caller asks for `format: "plugin"`. Returns the module object so the
 * caller can do `new Mod.PluginGenerator(...)`.
 */
async function loadPluginGenerator(): Promise<any | null> {
  try {
    return await import("../generators/plugin-generator.js");
  } catch {
    return null;
  }
}

/**
 * Resolve the generated-plugins directory path from config root.
 */
function getGeneratedPluginsDir(configRoot: string): string {
  return join(configRoot, "agents", "hera-generated");
}

export function createAgentTools(ctx: PluginContext) {
  const { skillManager, store, agentRegistry, registeredAgents, client, paths } = ctx;

  return {
    hera_create_agent: tool({
      description:
        "Create a new agent that persists across restarts. Optionally use a template (general, coder, reviewer, researcher, coordinator). Set format to 'plugin' to generate a code plugin instead of a .md file.",
      args: {
        name: z.string().describe("Unique agent name (lowercase, hyphens OK)"),
        description: z.string().describe("What this agent does"),
        prompt: z.string().describe("System prompt defining agent behavior"),
        mode: z.enum(["primary", "subagent", "all"]).describe("Agent mode"),
        model: z.string().optional().describe("Model override"),
        skills: z.array(z.string()).optional().describe("Additional skills to embed"),
        template: z
          .enum([
            "general",
            "coder",
            "reviewer",
            "researcher",
            "coordinator",
            "architect",
            "debugger",
            "tester",
            "documenter",
            "optimizer",
          ])
          .optional()
          .describe("Agent template to use"),
        max_steps: z.number().optional().describe("Maximum agentic steps"),
        format: z
          .enum(["md", "plugin"])
          .optional()
          .describe(
            "Output format: 'md' creates a .md file (default), 'plugin' generates a code plugin"
          ),
        auto_install: z
          .boolean()
          .optional()
          .describe(
            "When format is 'plugin', auto-install after generation (adds to opencode.json)"
          ),
      },
      async execute(args) {
        // Validate agent name
        const validation = validateAgentNameWithConflict(args.name, registeredAgents);
        if (!validation.valid) {
          let msg = `Error: ${validation.error}`;
          if (validation.suggestion) msg += ` Suggestion: "${validation.suggestion}".`;
          return msg;
        }

        let agentDef: AgentDefinition;
        if (args.template) {
          agentDef = createAgentFromTemplate(
            args.template as AgentTemplateName,
            args.name,
            args.prompt,
            args.model
          );
          agentDef.description = args.description;
        } else {
          agentDef = {
            name: args.name,
            description: args.description,
            mode: args.mode,
            prompt: args.prompt,
            model: args.model,
            skills: getDefaultSkills(args.skills),
            maxSteps: args.max_steps ?? DEFAULT_CHILD_MAX_STEPS,
            createdAt: Date.now(),
            evolutionLog: [],
          };
        }

        const format = args.format ?? "md";

        // Plugin format: generate code plugin using PluginGenerator
        if (format === "plugin") {
          const Mod = await loadPluginGenerator();
          if (!Mod) {
            return `Error: Plugin generator not available. The plugin-generator module is required for format="plugin". Ensure the generators module is built.`;
          }

          try {
            const generator = new Mod.PluginGenerator();
            const generatedDir = getGeneratedPluginsDir(paths.configRoot);
            await mkdir(generatedDir, { recursive: true });
            const pluginDir = join(generatedDir, args.name);

            // Resolve agent's declared skills to SkillDefinitions so additional
            // user skills are embedded into the generated plugin's prompt.
            // Built-in skills (caveman/init/memory/evolution) are embedded by
            // buildAgentPrompt regardless of what we pass here.
            const skillMap = skillManager.getSkillMap();
            const resolvedSkills = agentDef.skills
              .map((n: string) => skillMap.get(n))
              .filter(Boolean);

            const pkg = generator.generate(agentDef, resolvedSkills);
            await generator.writeToDisk(pkg, pluginDir);

            // Optionally auto-install: actually runs bun install/build/add
            // and updates opencode.json. No manual user steps required.
            if (args.auto_install === true) {
              const result = await generator.installWithBuild(pluginDir, paths.configRoot);
              if (result.ok) {
                return [
                  `Agent "${args.name}" generated and installed as plugin.`,
                  `Plugin directory: ${pluginDir}`,
                  `Auto-installed: build OK, opencode.json updated.`,
                  ``,
                  `Restart OpenCode to load the new plugin.`,
                ].join("\n");
              }
              // Build/install failed — surface which step and why
              const failedStep = result.steps.find((s: any) => !s.ok);
              return [
                `Agent "${args.name}" generated but auto-install failed at step: ${failedStep?.name ?? "unknown"}.`,
                `Plugin directory: ${pluginDir}`,
                failedStep?.stderr ? `Error: ${failedStep.stderr.slice(0, 500)}` : "",
                ``,
                `Manual fallback:`,
                `1. cd ${pluginDir} && bun install && bun run build`,
                `2. cd ~/.config/opencode && bun add file://${pluginDir}`,
              ]
                .filter(Boolean)
                .join("\n");
            }

            return [
              `Agent "${args.name}" generated as plugin.`,
              `Plugin directory: ${pluginDir}`,
              ``,
              `Next steps:`,
              `1. cd ${pluginDir} && bun install && bun run build`,
              `2. cd ~/.config/opencode && bun add file://${pluginDir}`,
              `3. Add "${args.name}" to opencode.json plugin array`,
              ``,
              `Or run: hera_install_agent agent_name="${args.name}"`,
            ].join("\n");
          } catch (err: any) {
            return `Error generating plugin for "${args.name}": ${err?.message ?? String(err)}`;
          }
        }

        // Default md format: existing behavior
        const skillsMap = skillManager.getSkillMap();
        const { fileWritten } = await persistAgent(
          agentDef,
          skillsMap,
          registeredAgents,
          agentRegistry,
          store
        );
        return [
          `Agent "${args.name}" created and registered.`,
          `Mode: ${agentDef.mode}. Skills: ${agentDef.skills.join(", ")}.`,
          `Available now via @${args.name} or opencode --agent ${args.name}.`,
          `Persisted to ${fileWritten}.`,
        ].join("\n");
      },
    }),

    hera_install_agent: tool({
      description:
        "Install a generated agent plugin by adding it to opencode.json. The plugin must already exist in the hera-generated directory.",
      args: {
        agent_name: z
          .string()
          .describe("Agent name to install (must exist in hera-generated directory)"),
      },
      async execute(args) {
        const Mod = await loadPluginGenerator();
        if (!Mod) {
          return `Error: Plugin generator not available. The plugin-generator module is required for installation. Ensure the generators module is built.`;
        }

        const pluginDir = join(getGeneratedPluginsDir(paths.configRoot), args.agent_name);

        // Verify the plugin directory exists
        try {
          const { stat } = await import("node:fs/promises");
          await stat(pluginDir);
        } catch {
          return `Error: Generated plugin not found at "${pluginDir}". Use hera_create_agent with format="plugin" to generate it first.`;
        }

        try {
          const generator = new Mod.PluginGenerator();
          await generator.install(pluginDir, paths.configRoot);
          return `Agent "${args.agent_name}" installed successfully. Plugin added to opencode.json.`;
        } catch (err: any) {
          return `Error installing agent "${args.agent_name}": ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_uninstall_agent: tool({
      description:
        "Uninstall a generated agent plugin by removing it from opencode.json. The plugin files are kept on disk.",
      args: {
        agent_name: z.string().describe("Agent name to uninstall"),
      },
      async execute(args) {
        const Mod = await loadPluginGenerator();
        if (!Mod) {
          return `Error: Plugin generator not available. The plugin-generator module is required for uninstallation. Ensure the generators module is built.`;
        }

        try {
          const generator = new Mod.PluginGenerator();
          await generator.uninstall(args.agent_name, paths.configRoot);
          return `Agent "${args.agent_name}" uninstalled successfully. Plugin removed from opencode.json.`;
        } catch (err: any) {
          return `Error uninstalling agent "${args.agent_name}": ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_list_agents: tool({
      description:
        "List all agents created by Hera. Optionally filter by mode, template, or skill.",
      args: {
        mode: z.enum(["primary", "subagent", "all"]).optional().describe("Filter by agent mode"),
        template: z.string().optional().describe("Filter by template name"),
        skill: z.string().optional().describe("Filter by skill name (agent must have this skill)"),
      },
      async execute(args) {
        const diskAgents = await agentRegistry.listRegistered();
        const memAgents = Array.from(registeredAgents.keys());
        const all = [...new Set([...diskAgents, ...memAgents])];
        if (all.length === 0) return "No agents created yet. Use hera_create_agent to create one.";
        let lines = await Promise.all(
          all.map(async (name) => {
            const def = registeredAgents.get(name) ?? (await agentRegistry.readDefinition(name));
            if (!def)
              return {
                line: `- **${name}**: (definition not found)`,
                def: null as AgentDefinition | null,
              };
            const onDisk = diskAgents.includes(name) ? "persisted" : "session-only";
            const tpl = def.template ? ` [template: ${def.template}]` : "";
            return {
              line: `- **${name}**: ${def.description} [${def.mode}]${tpl} Skills: ${def.skills.join(", ")} (${onDisk})`,
              def,
            };
          })
        );
        // Apply filters
        if (args.mode || args.template || args.skill) {
          lines = lines.filter((entry) => {
            if (!entry.def) return false;
            if (args.mode && entry.def.mode !== args.mode) return false;
            if (args.template && entry.def.template !== args.template) return false;
            if (args.skill && !entry.def.skills.includes(args.skill)) return false;
            return true;
          });
        }
        if (lines.length === 0) return "No agents match the given filters.";
        return lines.map((e) => e.line).join("\n");
      },
    }),

    hera_delete_agent: tool({
      description: "Delete a Hera-created agent.",
      args: { name: z.string().describe("Agent name to delete") },
      async execute(args) {
        await removeAgent(args.name, registeredAgents, agentRegistry, store);
        return `Agent "${args.name}" deleted.`;
      },
    }),

    hera_spawn_agent: tool({
      description: "Spawn an agent as a real OpenCode session immediately.",
      args: {
        agent_name: z.string().describe("Agent name to spawn"),
        task: z.string().describe("Task prompt for the agent"),
      },
      async execute(args, ctx) {
        const hasClient = client && typeof client.session?.create === "function";
        if (!hasClient)
          return `Error: Session API not available. This feature requires an active OpenCode session. Try running within an OpenCode session or check your plugin installation.`;
        if (!registeredAgents.has(args.agent_name))
          return `Error: Agent "${args.agent_name}" not found. Use hera_list_agents to see available agents, or create it with hera_create_agent.`;
        try {
          const createResult = await client.session.create({
            body: { parentID: ctx.sessionID, title: `Hera spawn → @${args.agent_name}` },
            query: { directory: ctx.directory },
          });
          const sessionId = createResult.data?.id ?? createResult.data;
          await client.session.promptAsync({
            path: { id: sessionId },
            body: { agent: args.agent_name, parts: [{ type: "text", text: args.task }] },
          });
          return `Agent "${args.agent_name}" spawned in session ${sessionId}.`;
        } catch (err: any) {
          return `Error spawning agent: ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_verify_agent: tool({
      description: "Verify that an agent is properly registered and accessible.",
      args: {
        name: z.string().describe("Agent name to verify"),
      },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def)
          return `Error: Agent "${args.name}" not registered. Use hera_list_agents to see available agents. If missing, create it with hera_create_agent.`;

        const diskAgents = await agentRegistry.listRegistered();
        const onDisk = diskAgents.includes(args.name);

        const lines = [
          `Agent "${args.name}" verified.`,
          ``,
          `**Status**: ${onDisk ? "Persisted to disk" : "Session-only (not persisted)"}`,
          `**Mode**: ${def.mode}`,
          `**Template**: ${def.template ?? "custom"}`,
          `**Skills**: ${def.skills.join(", ")}`,
          `**Model**: ${def.model ?? "default"}`,
          `**Created**: ${def.createdAt ? new Date(def.createdAt).toISOString() : "unknown"}`,
        ];

        if (def.evolutionLog && def.evolutionLog.length > 0) {
          const active = def.evolutionLog.filter((e) => !e.rolledBack);
          lines.push(`**Evolutions**: ${active.length} active`);
        }

        if (onDisk) {
          const filePath = `~/.config/opencode/agents/hera/${args.name}.md`;
          lines.push(`**File**: ${filePath}`);
        }

        return lines.join("\n");
      },
    }),

    hera_export_agent: tool({
      description: "Export agent definition as JSON for backup or sharing.",
      args: {
        name: z.string().describe("Agent name to export"),
      },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def)
          return `Error: Agent "${args.name}" not found. Use hera_list_agents to see available agents, or create it with hera_create_agent.`;

        return JSON.stringify(def, null, 2);
      },
    }),

    hera_import_agent: tool({
      description: "Import agent from JSON definition.",
      args: {
        json: z.string().describe("JSON agent definition"),
      },
      async execute(args) {
        try {
          const def = JSON.parse(args.json) as AgentDefinition;
          if (!def.name || !def.description || !def.mode || !def.prompt) {
            return "Error: Invalid agent definition. Missing required fields.";
          }

          const skillsMap = skillManager.getSkillMap();
          const { fileWritten } = await persistAgent(
            def,
            skillsMap,
            registeredAgents,
            agentRegistry,
            store
          );

          return `Agent "${def.name}" imported successfully. Persisted to ${fileWritten}.`;
        } catch (err: any) {
          return `Error importing agent: ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_quickstart: tool({
      description:
        "One-command agent creation with automatic template suggestion. Analyzes purpose text to pick the best template, name, and mode.",
      args: {
        purpose: z
          .string()
          .describe("What the agent should do (e.g., 'review code', 'write tests')"),
      },
      async execute(args) {
        const template = suggestTemplate(args.purpose);
        const mode = suggestMode(template);
        const baseName = slugifyName(args.purpose);
        const name = findAvailableName(baseName, registeredAgents);

        // Validate the generated name
        const nameCheck = validateAgentNameWithConflict(name, registeredAgents);
        if (!nameCheck.valid) {
          return `Error: Could not generate a valid agent name from "${args.purpose}". ${nameCheck.error} Please use hera_create_agent with a custom name.`;
        }

        const agentDef = createAgentFromTemplate(template, name, undefined, undefined);
        const skillsMap = skillManager.getSkillMap();
        const { fileWritten } = await persistAgent(
          agentDef,
          skillsMap,
          registeredAgents,
          agentRegistry,
          store
        );

        const usageLine =
          mode === "subagent"
            ? `Use @${name} in your prompt to invoke this agent.`
            : `Use opencode --agent ${name} or @${name} to start.`;

        return [
          `Agent "${name}" created via quickstart.`,
          `Template: ${template}. Mode: ${mode}. Skills: ${agentDef.skills.join(", ")}.`,
          usageLine,
          `Persisted to ${fileWritten}.`,
          `Tip: Customize with hera_evolve_agent or edit the .md file directly.`,
        ].join("\n");
      },
    }),
  };
}
