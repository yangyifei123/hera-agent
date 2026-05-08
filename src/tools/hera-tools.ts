// Hera Tools — 14 custom tools for the Hera agent system

import { tool } from "@opencode-ai/plugin";
import { randomUUID } from "node:crypto";
import type { SkillManager } from "../skills/manager.js";
import type { TeamManager } from "../team/manager.js";
import type { DistillationEngine } from "../distillation/engine.js";
import type { MemoryStore } from "../memory/store.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition, HeraConfig } from "../types.js";

const z = tool.schema;

export function createHeraTools(deps: {
  skillManager: SkillManager;
  teamManager: TeamManager;
  distillation: DistillationEngine;
  memoryStore: MemoryStore;
  agentRegistry: AgentRegistry;
  config: HeraConfig;
  registeredAgents: Map<string, AgentDefinition>;
  client: any;
}) {
  const { skillManager, teamManager, distillation, memoryStore, agentRegistry, registeredAgents, client } = deps;

  return {
    // === Agent Creation ===

    "hera_create_agent": tool({
      description:
        "Create a new agent that persists across restarts. The agent is written to ~/.config/opencode/agents/hera/<name>.md so it appears in `opencode list agent`. In the current session it's also available immediately.",
      args: {
        name: z.string().describe("Unique agent name (lowercase, hyphens OK)"),
        description: z.string().describe("What this agent does"),
        prompt: z.string().describe("System prompt defining agent behavior"),
        mode: z.enum(["primary", "subagent", "all"]).describe("Agent mode"),
        model: z.string().optional().describe("Model override (optional)"),
        skills: z.array(z.string()).optional().describe("Skills to embed (caveman always included)"),
        max_steps: z.number().optional().describe("Maximum agentic steps"),
      },
      async execute(args, ctx) {
        const agentDef: AgentDefinition = {
          name: args.name,
          description: args.description,
          mode: args.mode,
          prompt: args.prompt,
          model: args.model,
          skills: [...new Set(["caveman", ...(args.skills ?? [])])],
          maxSteps: args.max_steps ?? 30,
        };

        registeredAgents.set(args.name, agentDef);

        // Write to opencode agents dir for native discovery
        const skillsMap = skillManager.getSkillMap();
        const { config: agentConfig, fileWritten } = await agentRegistry.register(agentDef, skillsMap);

        // Also save to Hera's memory
        await memoryStore.save({
          id: `agent-${args.name}`,
          type: "agent",
          content: JSON.stringify(agentDef),
          timestamp: Date.now(),
          metadata: { mode: args.mode, skills: agentDef.skills, fileWritten },
        });

        return [
          `Agent "${args.name}" created and registered.`,
          `Mode: ${args.mode}. Skills: ${agentDef.skills.join(", ")}.`,
          `Available now via @${args.name} in current session.`,
          `Persisted to ${fileWritten} — survives restart.`,
          `Will appear in 'opencode list agent' after restart.`,
        ].join("\n");
      },
    }),

    "hera_list_agents": tool({
      description: "List all agents created by Hera (from memory + filesystem).",
      args: {},
      async execute() {
        // Read from filesystem to show truly persisted agents
        const diskAgents = await agentRegistry.listRegistered();
        const memAgents = Array.from(registeredAgents.keys());
        const all = [...new Set([...diskAgents, ...memAgents])];

        if (all.length === 0) return "No agents created yet. Use hera_create_agent to create one.";

        const lines = await Promise.all(all.map(async (name) => {
          const def = registeredAgents.get(name) ?? await agentRegistry.readDefinition(name);
          if (!def) return `- **${name}**: (definition not found)`;
          const onDisk = diskAgents.includes(name) ? "✓ persisted" : "session-only";
          return `- **${name}**: ${def.description} [${def.mode}] Skills: ${def.skills.join(", ")} (${onDisk})`;
        }));
        return lines.join("\n");
      },
    }),

    "hera_delete_agent": tool({
      description: "Delete a Hera-created agent. Removes from disk, memory, and current session.",
      args: {
        name: z.string().describe("Agent name to delete"),
      },
      async execute(args) {
        registeredAgents.delete(args.name);
        await agentRegistry.unregister(args.name);
        await memoryStore.delete("agent", `agent-${args.name}`);
        return `Agent "${args.name}" deleted from disk, memory, and current session. Will NOT appear in 'opencode list agent' after restart.`;
      },
    }),

    // === Skill Tools ===

    "hera_create_skill": tool({
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
        });
        return `Skill "${args.name}" created and persisted. Available for agent embedding.`;
      },
    }),

    "hera_list_skills": tool({
      description: "List all skills (built-in + user-created).",
      args: {},
      async execute() {
        const skills = skillManager.getAllSkills();
        return skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
      },
    }),

    "hera_delete_skill": tool({
      description: "Delete a user-created skill. Built-in skills (caveman) cannot be removed.",
      args: { name: z.string().describe("Skill name") },
      async execute(args) {
        const ok = await skillManager.deleteSkill(args.name);
        return ok
          ? `Skill "${args.name}" deleted.`
          : `Cannot delete "${args.name}". Built-in skills cannot be removed.`;
      },
    }),

    "hera_upgrade_to_agent": tool({
      description: "Upgrade one or more skills into a full agent. The skills become the agent's core behavior.",
      args: {
        agent_name: z.string().describe("Name for the new agent"),
        description: z.string().describe("Agent description"),
        skill_names: z.array(z.string()).describe("Skills to upgrade"),
        mode: z.enum(["primary", "subagent", "all"]).describe("Agent mode"),
        model: z.string().optional().describe("Model override"),
      },
      async execute(args) {
        const agentPrompt = skillManager.upgradeSkillsToAgentPrompt(
          args.agent_name, args.skill_names, args.description
        );
        const agentDef: AgentDefinition = {
          name: args.agent_name,
          description: args.description,
          mode: args.mode,
          prompt: agentPrompt,
          model: args.model,
          skills: [...new Set(["caveman", ...args.skill_names])],
          maxSteps: 30,
        };
        registeredAgents.set(args.agent_name, agentDef);

        const skillsMap = skillManager.getSkillMap();
        const { fileWritten } = await agentRegistry.register(agentDef, skillsMap);

        await memoryStore.save({
          id: `agent-${args.agent_name}`,
          type: "agent",
          content: JSON.stringify(agentDef),
          timestamp: Date.now(),
          metadata: { mode: args.mode, skills: agentDef.skills, upgradedFrom: args.skill_names, fileWritten },
        });

        return `Skills [${args.skill_names.join(", ")}] upgraded to agent "${args.agent_name}" (${args.mode}). Persisted to ${fileWritten}. Use @${args.agent_name} to invoke.`;
      },
    }),

    // === Team Tools ===

    "hera_create_team": tool({
      description: "Create an agent team. Members are real OpenCode sessions that collaborate via the session API.",
      args: {
        name: z.string().describe("Team name"),
        description: z.string().describe("Team purpose"),
        coordination: z.enum(["parallel", "sequential", "adaptive"]).describe("Coordination mode"),
        members: z.array(z.object({
          agent_name: z.string().describe("Must be a created agent"),
          role: z.string().describe("Member role"),
        })).describe("Team members"),
      },
      async execute(args) {
        const missing = args.members.filter((m) => !registeredAgents.has(m.agent_name));
        if (missing.length > 0) {
          return `Error: Unknown agents: ${missing.map((m) => m.agent_name).join(", ")}. Create them first with hera_create_agent.`;
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
        };
        await teamManager.createTeam(team);
        return `Team "${args.name}" created with ${args.members.length} members (${args.coordination}). Use hera_spawn_team to launch tasks.`;
      },
    }),

    "hera_list_teams": tool({
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

    "hera_spawn_team": tool({
      description: "Launch a team task — spawns real OpenCode sessions for each team member. Returns session IDs for tracking.",
      args: {
        team_name: z.string().describe("Team name"),
        task_prompt: z.string().describe("The task to execute"),
      },
      async execute(args, ctx) {
        try {
          const sessions = await teamManager.spawnTeam(
            args.team_name,
            args.task_prompt,
            ctx.sessionID,
            ctx.directory
          );
          const lines = sessions.map((s) =>
            `- ${s.agentName}: ${s.status} (session: ${s.sessionId})${s.result ? `\n  Result: ${s.result.slice(0, 200)}` : ""}`
          );
          return `Team "${args.team_name}" spawned:\n${lines.join("\n")}`;
        } catch (err: any) {
          return `Error spawning team: ${err?.message ?? String(err)}`;
        }
      },
    }),

    "hera_team_message": tool({
      description: "Send a message between team members. Use 'broadcast' to reach all.",
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
        if (!memberNames.includes(args.from)) {
          return `Error: "${args.from}" is not a member of "${args.team_name}".`;
        }
        const msg = teamManager.sendMessage(
          args.team_name, args.from, args.to, args.content,
          (args.kind as any) ?? "message"
        );
        return `Message sent from ${args.from} to ${args.to} in ${args.team_name}. ID: ${msg.id}`;
      },
    }),

    // === Memory ===

    "hera_remember": tool({
      description: "Store information in Hera's persistent memory.",
      args: {
        content: z.string().describe("Information to remember"),
        category: z.enum(["session", "skill", "agent", "team", "distillation"]).describe("Category"),
      },
      async execute(args) {
        await memoryStore.save({
          id: `memo-${randomUUID().slice(0, 8)}`,
          type: args.category,
          content: args.content,
          timestamp: Date.now(),
        });
        return `Remembered in ${args.category} memory.`;
      },
    }),

    "hera_recall": tool({
      description: "Search Hera's persistent memory.",
      args: {
        query: z.string().describe("Search query"),
        category: z.enum(["session", "skill", "agent", "team", "distillation"]).optional().describe("Filter"),
      },
      async execute(args) {
        const results = await memoryStore.search(args.query, args.category);
        if (results.length === 0) return "No matching memories found.";
        return results.slice(0, 10).map((m) => `[${m.type}] ${m.content.slice(0, 200)}`).join("\n---\n");
      },
    }),

    // === Distillation ===

    "hera_distill_session": tool({
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
