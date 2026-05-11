import { tool } from "@opencode-ai/plugin";
import { randomUUID } from "node:crypto";
import type { PluginContext, AgentDefinition, AgentTemplateName } from "../types.js";
import { createAgentFromTemplate, AGENT_TEMPLATES } from "../agents/hera.js";

const z = tool.schema;

export function createAllTools(ctx: PluginContext) {
  const { skillManager, teamManager, distillation, store, agentRegistry, registeredAgents, client, config } = ctx;

  return {
    // === Agent Tools ===

    hera_create_agent: tool({
      description: "Create a new agent that persists across restarts. Optionally use a template (general, coder, reviewer, researcher, coordinator).",
      args: {
        name: z.string().describe("Unique agent name (lowercase, hyphens OK)"),
        description: z.string().describe("What this agent does"),
        prompt: z.string().describe("System prompt defining agent behavior"),
        mode: z.enum(["primary", "subagent", "all"]).describe("Agent mode"),
        model: z.string().optional().describe("Model override"),
        skills: z.array(z.string()).optional().describe("Additional skills to embed"),
        template: z.enum(["general", "coder", "reviewer", "researcher", "coordinator"]).optional().describe("Agent template to use"),
        max_steps: z.number().optional().describe("Maximum agentic steps"),
      },
      async execute(args) {
        let agentDef: AgentDefinition;
        if (args.template) {
          agentDef = createAgentFromTemplate(args.template as AgentTemplateName, args.name, args.prompt, args.model);
          agentDef.description = args.description;
        } else {
          agentDef = {
            name: args.name,
            description: args.description,
            mode: args.mode,
            prompt: args.prompt,
            model: args.model,
            skills: [...new Set(["caveman", "init", "memory", "evolution", ...(args.skills ?? [])])],
            maxSteps: args.max_steps ?? 30,
            createdAt: Date.now(),
            evolutionLog: [],
          };
        }
        registeredAgents.set(args.name, agentDef);
        const skillsMap = skillManager.getSkillMap();
        const { config: agentConfig, fileWritten } = await agentRegistry.register(agentDef, skillsMap);
        await store.save({
          id: `agent-${args.name}`,
          type: "agent",
          content: JSON.stringify(agentDef),
          timestamp: Date.now(),
          metadata: { mode: agentDef.mode, skills: agentDef.skills, fileWritten },
        });
        return [
          `Agent "${args.name}" created and registered.`,
          `Mode: ${agentDef.mode}. Skills: ${agentDef.skills.join(", ")}.`,
          `Available now via @${args.name} or opencode --agent ${args.name}.`,
          `Persisted to ${fileWritten}.`,
        ].join("\n");
      },
    }),

    hera_list_agents: tool({
      description: "List all agents created by Hera.",
      args: {},
      async execute() {
        const diskAgents = await agentRegistry.listRegistered();
        const memAgents = Array.from(registeredAgents.keys());
        const all = [...new Set([...diskAgents, ...memAgents])];
        if (all.length === 0) return "No agents created yet. Use hera_create_agent to create one.";
        const lines = await Promise.all(all.map(async (name) => {
          const def = registeredAgents.get(name) ?? await agentRegistry.readDefinition(name);
          if (!def) return `- **${name}**: (definition not found)`;
          const onDisk = diskAgents.includes(name) ? "persisted" : "session-only";
          const tpl = def.template ? ` [template: ${def.template}]` : "";
          return `- **${name}**: ${def.description} [${def.mode}]${tpl} Skills: ${def.skills.join(", ")} (${onDisk})`;
        }));
        return lines.join("\n");
      },
    }),

    hera_delete_agent: tool({
      description: "Delete a Hera-created agent.",
      args: { name: z.string().describe("Agent name to delete") },
      async execute(args) {
        registeredAgents.delete(args.name);
        await agentRegistry.unregister(args.name);
        await store.delete("agent", `agent-${args.name}`);
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
        if (!hasClient) return `Error: Session API not available. Cannot spawn ${args.agent_name}.`;
        if (!registeredAgents.has(args.agent_name)) return `Error: Agent "${args.agent_name}" not found. Create it first.`;
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

    // === Skill Tools ===

    hera_create_skill: tool({
      description: "Create a reusable skill. Skills define behavior patterns embeddable in agents.",
      args: {
        name: z.string().describe("Skill name"),
        description: z.string().describe("What it does"),
        trigger: z.string().describe("When to activate"),
        prompt: z.string().describe("Instruction prompt"),
      },
      async execute(args) {
        await skillManager.createSkill({
          name: args.name,
          description: args.description,
          trigger: args.trigger,
          prompt: args.prompt,
          category: "user",
        });
        return `Skill "${args.name}" created and persisted.`;
      },
    }),

    hera_list_skills: tool({
      description: "List all skills (builtin + user-created).",
      args: {},
      async execute() {
        const skills = skillManager.getAllSkills();
        return skills.map((s) => `- **${s.name}** (${s.category}): ${s.description}`).join("\n");
      },
    }),

    hera_delete_skill: tool({
      description: "Delete a user-created skill. Built-in skills cannot be removed.",
      args: { name: z.string().describe("Skill name") },
      async execute(args) {
        const ok = await skillManager.deleteSkill(args.name);
        return ok ? `Skill "${args.name}" deleted.` : `Cannot delete "${args.name}". Built-in skills are protected.`;
      },
    }),

    hera_upgrade_to_agent: tool({
      description: "Upgrade one or more skills into a full agent.",
      args: {
        agent_name: z.string().describe("Name for the new agent"),
        description: z.string().describe("Agent description"),
        skill_names: z.array(z.string()).describe("Skills to upgrade"),
        mode: z.enum(["primary", "subagent", "all"]).describe("Agent mode"),
        model: z.string().optional().describe("Model override"),
      },
      async execute(args) {
        const agentPrompt = skillManager.upgradeSkillsToAgentPrompt(args.agent_name, args.skill_names, args.description);
        const agentDef: AgentDefinition = {
          name: args.agent_name,
          description: args.description,
          mode: args.mode,
          prompt: agentPrompt,
          model: args.model,
          skills: [...new Set(["caveman", "init", "memory", "evolution", ...args.skill_names])],
          maxSteps: 30,
          createdAt: Date.now(),
          evolutionLog: [],
        };
        registeredAgents.set(args.agent_name, agentDef);
        const skillsMap = skillManager.getSkillMap();
        const { fileWritten } = await agentRegistry.register(agentDef, skillsMap);
        await store.save({
          id: `agent-${args.agent_name}`,
          type: "agent",
          content: JSON.stringify(agentDef),
          timestamp: Date.now(),
          metadata: { mode: args.mode, upgradedFrom: args.skill_names },
        });
        return `Skills [${args.skill_names.join(", ")}] upgraded to agent "${args.agent_name}" (${args.mode}). Persisted to ${fileWritten}.`;
      },
    }),

    // === Team Tools ===

    hera_create_team: tool({
      description: "Create an agent team with real OpenCode session members.",
      args: {
        name: z.string().describe("Team name"),
        description: z.string().describe("Team purpose"),
        coordination: z.enum(["parallel", "sequential", "adaptive"]).describe("Coordination mode"),
        members: z.array(z.object({
          agent_name: z.string().describe("Agent name (must be created first)"),
          role: z.string().describe("Member role"),
        })).describe("Team members"),
      },
      async execute(args) {
        const missing = args.members.filter((m) => !registeredAgents.has(m.agent_name));
        if (missing.length > 0) {
          return `Error: Unknown agents: ${missing.map((m) => m.agent_name).join(", ")}. Create them first.`;
        }
        const team = {
          name: args.name,
          description: args.description,
          coordination: args.coordination,
          members: args.members.map((m) => ({
            agentName: m.agent_name,
            role: m.role,
            subscriptions: ["message", "task", "result"],
            backendType: "in-process" as const,
          })),
          sharedMemory: [],
          createdAt: Date.now(),
        };
        await teamManager.createTeam(team);
        return `Team "${args.name}" created with ${args.members.length} members (${args.coordination}).`;
      },
    }),

    hera_list_teams: tool({
      description: "List all teams and their status.",
      args: {},
      async execute() {
        const teams = teamManager.getAllTeams();
        if (teams.length === 0) return "No teams created yet.";
        return teams.map((t) => {
          const members = t.members.map((m) => `${m.agentName}(${m.role})`).join(", ");
          return `- **${t.name}** (${t.coordination}): ${t.description} — Members: ${members}`;
        }).join("\n");
      },
    }),

    hera_delete_team: tool({
      description: "Delete a team.",
      args: { name: z.string().describe("Team name") },
      async execute(args) {
        const ok = await teamManager.deleteTeam(args.name);
        return ok ? `Team "${args.name}" deleted.` : `Team "${args.name}" not found.`;
      },
    }),

    hera_spawn_team: tool({
      description: "Launch a team task — spawns real OpenCode sessions for each member.",
      args: {
        team_name: z.string().describe("Team name"),
        task_prompt: z.string().describe("The task to execute"),
      },
      async execute(args, ctx) {
        try {
          const sessions = await teamManager.spawnTeam(args.team_name, args.task_prompt, ctx.sessionID, ctx.directory);
          const lines = sessions.map((s) =>
            `- ${s.agentName}: ${s.status} (session: ${s.sessionId})${s.result ? `\n  Result: ${s.result.slice(0, 200)}` : ""}`
          );
          return `Team "${args.team_name}" spawned:\n${lines.join("\n")}`;
        } catch (err: any) {
          return `Error spawning team: ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_team_message: tool({
      description: "Send a message between team members.",
      args: {
        team_name: z.string().describe("Team name"),
        from: z.string().describe("Sender agent name"),
        to: z.string().describe("Recipient or 'broadcast'"),
        content: z.string().describe("Message content"),
        kind: z.enum(["message", "task", "result"]).optional().describe("Message kind"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) return `Error: Team "${args.team_name}" not found.`;
        const memberNames = team.members.map((m) => m.agentName);
        if (!memberNames.includes(args.from)) return `Error: "${args.from}" is not a member of "${args.team_name}".`;
        const msg = teamManager.sendMessage(args.team_name, args.from, args.to, args.content, (args.kind as any) ?? "message");
        return `Message sent from ${args.from} to ${args.to} in ${args.team_name}. ID: ${msg.id}`;
      },
    }),

    // === Memory Tools ===

    hera_remember: tool({
      description: "Store information in Hera's persistent memory.",
      args: {
        content: z.string().describe("Information to remember"),
        category: z.enum(["session", "skill", "agent", "team", "distillation", "preference", "decision", "pattern", "fix", "context"]).describe("Category"),
      },
      async execute(args) {
        await store.save({
          id: `memo-${randomUUID().slice(0, 8)}`,
          type: args.category as any,
          content: args.content,
          timestamp: Date.now(),
        });
        return `Remembered in ${args.category} memory.`;
      },
    }),

    hera_recall: tool({
      description: "Search Hera's persistent memory.",
      args: {
        query: z.string().describe("Search query"),
        category: z.enum(["session", "skill", "agent", "team", "distillation", "preference", "decision", "pattern", "fix", "context"]).optional().describe("Filter"),
      },
      async execute(args) {
        const results = await store.search(args.query, args.category as any);
        if (results.length === 0) return "No matching memories found.";
        return results.slice(0, 10).map((m) => `[${m.type}] ${m.content.slice(0, 200)}`).join("\n---\n");
      },
    }),

    // === Evolution Tools ===

    hera_evolve_agent: tool({
      description: "Append an evolution directive to an agent. Agent will self-improve based on reflection.",
      args: {
        name: z.string().describe("Agent name"),
        trigger: z.string().describe("What triggered this evolution"),
        observation: z.string().describe("What was observed"),
        directive: z.string().describe("New rule to add"),
      },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def) return `Error: Agent "${args.name}" not found.`;
        if (!def.evolutionLog) def.evolutionLog = [];
        const entry = { timestamp: Date.now(), trigger: args.trigger, observation: args.observation, directive: args.directive, rolledBack: false };
        def.evolutionLog.push(entry);
        def.evolvedAt = Date.now();
        registeredAgents.set(args.name, def);
        await agentRegistry.appendEvolution(args.name, entry);
        await store.save({
          id: `agent-${args.name}`,
          type: "agent",
          content: JSON.stringify(def),
          timestamp: Date.now(),
          metadata: { evolved: true },
        });
        return `Agent "${args.name}" evolved. Directive added: "${args.directive}". Evolution count: ${def.evolutionLog.filter((e) => !e.rolledBack).length}.`;
      },
    }),

    hera_list_evolutions: tool({
      description: "List evolution history for an agent.",
      args: { name: z.string().describe("Agent name") },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def) return `Error: Agent "${args.name}" not found.`;
        if (!def.evolutionLog || def.evolutionLog.length === 0) return `Agent "${args.name}" has no evolution history.`;
        return def.evolutionLog.map((e, i) => {
          const status = e.rolledBack ? "[ROLLED BACK]" : "[ACTIVE]";
          return `${i + 1}. ${status} [${new Date(e.timestamp).toISOString()}] Trigger: ${e.trigger}\n   Directive: ${e.directive}`;
        }).join("\n\n");
      },
    }),

    hera_rollback_evolution: tool({
      description: "Rollback the latest evolution directive for an agent.",
      args: { name: z.string().describe("Agent name") },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def) return `Error: Agent "${args.name}" not found.`;
        if (!def.evolutionLog || def.evolutionLog.length === 0) return `Agent "${args.name}" has no evolution history.`;
        // Find last non-rolled-back entry
        for (let i = def.evolutionLog.length - 1; i >= 0; i--) {
          if (!def.evolutionLog[i].rolledBack) {
            def.evolutionLog[i].rolledBack = true;
            await agentRegistry.appendEvolution(args.name, def.evolutionLog[i]);
            return `Rolled back evolution: "${def.evolutionLog[i].directive}".`;
          }
        }
        return `All evolutions already rolled back.`;
      },
    }),

    // === Distillation Tool ===

    hera_distill_session: tool({
      description: "Distill a session into structured knowledge. Optionally auto-create a skill.",
      args: {
        session_id: z.string().describe("Session ID"),
        skill_name: z.string().optional().describe("Auto-create skill from distillation"),
      },
      async execute(args) {
        const result = await distillation.distillSession(args.session_id, [
          { role: "system", content: "Session distillation requested by Hera" },
        ]);
        if (args.skill_name) {
          const skill = await distillation.distillToSkill(args.skill_name, result);
          await skillManager.createSkill(skill);
          return `Session distilled. Created skill "${args.skill_name}". Patterns: ${result.patternsLearned.join(", ")}`;
        }
        return [
          `Session distilled.`,
          `Summary: ${result.summary}`,
          `Decisions: ${result.keyDecisions.join("; ")}`,
          `Patterns: ${result.patternsLearned.join(", ")}`,
        ].join("\n");
      },
    }),
  };
}
