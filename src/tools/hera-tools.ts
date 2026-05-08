// Hera Tools - Custom tools for the Hera agent system

import { tool } from "@opencode-ai/plugin";
import { randomUUID } from "node:crypto";
import type { SkillManager } from "../skills/manager.js";
import type { TeamManager } from "../team/manager.js";
import type { DistillationEngine } from "../distillation/engine.js";
import type { MemoryStore } from "../memory/store.js";
import type { AgentDefinition, HeraConfig } from "../types.js";

const z = tool.schema;

export function createHeraTools(deps: {
  skillManager: SkillManager;
  teamManager: TeamManager;
  distillation: DistillationEngine;
  memoryStore: MemoryStore;
  config: HeraConfig;
  registeredAgents: Map<string, AgentDefinition>;
}) {
  const { skillManager, teamManager, distillation, memoryStore, registeredAgents } = deps;

  return {
    // === Agent Creation Tools ===

    "hera_create_agent": tool({
      description:
        "Create a new agent. Specify name, description, prompt, mode (primary/subagent/all), optional model and skills. The agent will be registered and available for use.",
      args: {
        name: z.string().describe("Unique agent name (lowercase, hyphens OK)"),
        description: z.string().describe("What this agent does"),
        prompt: z.string().describe("System prompt defining agent behavior"),
        mode: z
          .enum(["primary", "subagent", "all"])
          .describe("Agent mode: primary=main, subagent=specialist, all=both"),
        model: z.string().optional().describe("Model to use (optional, inherits default)"),
        skills: z
          .array(z.string())
          .optional()
          .describe("Skill names to embed (caveman included by default)"),
        max_steps: z.number().optional().describe("Maximum agentic steps"),
      },
      async execute(args) {
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

        await memoryStore.save({
          id: `agent-${args.name}`,
          type: "agent",
          content: JSON.stringify(agentDef),
          timestamp: Date.now(),
          metadata: { mode: args.mode, skills: agentDef.skills },
        });

        return `Agent "${args.name}" created. Mode: ${args.mode}. Skills: ${agentDef.skills.join(", ")}. Use @${args.name} to invoke.`;
      },
    }),

    "hera_list_agents": tool({
      description: "List all agents created by Hera, their modes, skills, and status.",
      args: {},
      async execute() {
        const agents = Array.from(registeredAgents.entries());
        if (agents.length === 0) return "No agents created yet. Use hera_create_agent to create one.";

        return agents
          .map(([name, def]) => `- **${name}**: ${def.description} [${def.mode}] Skills: ${def.skills.join(", ")}`)
          .join("\n");
      },
    }),

    "hera_delete_agent": tool({
      description: "Delete a Hera-created agent by name.",
      args: {
        name: z.string().describe("Agent name to delete"),
      },
      async execute(args) {
        registeredAgents.delete(args.name);
        await memoryStore.delete("agent", `agent-${args.name}`);
        return `Agent "${args.name}" deleted.`;
      },
    }),

    // === Skill Tools ===

    "hera_create_skill": tool({
      description:
        "Create a new reusable skill. Skills define behavior patterns that can be embedded in agents.",
      args: {
        name: z.string().describe("Skill name (lowercase, hyphens OK)"),
        description: z.string().describe("What this skill does"),
        trigger: z.string().describe("When to activate this skill"),
        prompt: z.string().describe("The skill's instruction prompt"),
      },
      async execute(args) {
        await skillManager.createSkill({
          name: args.name,
          description: args.description,
          trigger: args.trigger,
          prompt: args.prompt,
        });
        return `Skill "${args.name}" created. Available for agent embedding.`;
      },
    }),

    "hera_list_skills": tool({
      description: "List all available skills including built-in and user-created.",
      args: {},
      async execute() {
        const skills = skillManager.getAllSkills();
        return skills
          .map((s) => `- **${s.name}**: ${s.description}`)
          .join("\n");
      },
    }),

    "hera_delete_skill": tool({
      description: "Delete a user-created skill (cannot delete built-in skills like caveman).",
      args: {
        name: z.string().describe("Skill name to delete"),
      },
      async execute(args) {
        const ok = await skillManager.deleteSkill(args.name);
        return ok ? `Skill "${args.name}" deleted.` : `Cannot delete "${args.name}". Built-in skills cannot be removed.`;
      },
    }),

    "hera_upgrade_to_agent": tool({
      description:
        "Upgrade one or more skills into a full agent. The skills become the agent's core behavior.",
      args: {
        agent_name: z.string().describe("Name for the new agent"),
        description: z.string().describe("Agent description"),
        skill_names: z
          .array(z.string())
          .describe("Skills to upgrade into this agent"),
        mode: z
          .enum(["primary", "subagent", "all"])
          .describe("Agent mode"),
        model: z.string().optional().describe("Model to use"),
      },
      async execute(args) {
        const agentPrompt = skillManager.upgradeSkillsToAgentPrompt(
          args.agent_name,
          args.skill_names,
          args.description
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

        await memoryStore.save({
          id: `agent-${args.agent_name}`,
          type: "agent",
          content: JSON.stringify(agentDef),
          timestamp: Date.now(),
          metadata: {
            mode: args.mode,
            skills: agentDef.skills,
            upgradedFrom: args.skill_names,
          },
        });

        return `Skills [${args.skill_names.join(", ")}] upgraded to agent "${args.agent_name}" (${args.mode}). Use @${args.agent_name} to invoke.`;
      },
    }),

    // === Team Tools ===

    "hera_create_team": tool({
      description:
        "Create an agent team. Members can collaborate in parallel, sequential, or adaptive mode.",
      args: {
        name: z.string().describe("Team name"),
        description: z.string().describe("Team purpose"),
        coordination: z
          .enum(["parallel", "sequential", "adaptive"])
          .describe("Coordination mode"),
        members: z
          .array(
            z.object({
              agent_name: z.string().describe("Agent name (must be created first)"),
              role: z.string().describe("Member role in team"),
            })
          )
          .describe("Team members"),
      },
      async execute(args) {
        const missing = args.members.filter(
          (m) => !registeredAgents.has(m.agent_name)
        );
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

        return `Team "${args.name}" created with ${args.members.length} members (${args.coordination}). Use hera_team_message for inter-member communication.`;
      },
    }),

    "hera_list_teams": tool({
      description: "List all agent teams.",
      args: {},
      async execute() {
        const teams = teamManager.getAllTeams();
        if (teams.length === 0) return "No teams created yet.";
        return teams
          .map((t) => {
            const members = t.members
              .map((m) => `${m.agentName}(${m.role})`)
              .join(", ");
            return `- **${t.name}** (${t.coordination}): ${t.description} — Members: ${members}`;
          })
          .join("\n");
      },
    }),

    "hera_team_message": tool({
      description:
        "Send a message between team members. Use 'broadcast' as recipient to reach all members.",
      args: {
        team_name: z.string().describe("Team name"),
        from: z.string().describe("Sender agent name"),
        to: z.string().describe("Recipient agent name or 'broadcast'"),
        content: z.string().describe("Message content"),
        kind: z
          .enum(["message", "task", "result"])
          .optional()
          .describe("Message kind"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) return `Error: Team "${args.team_name}" not found.`;

        const memberNames = team.members.map((m) => m.agentName);
        if (!memberNames.includes(args.from)) {
          return `Error: "${args.from}" is not a member of team "${args.team_name}".`;
        }

        const msg = teamManager.sendMessage(
          args.team_name,
          args.from,
          args.to,
          args.content,
          (args.kind as "message" | "task" | "result") ?? "message"
        );

        return `Message sent from ${args.from} to ${args.to} in team ${args.team_name}. ID: ${msg.id}`;
      },
    }),

    // === Memory Tools ===

    "hera_remember": tool({
      description: "Store important information in Hera's persistent memory.",
      args: {
        content: z.string().describe("Information to remember"),
        category: z
          .enum(["session", "skill", "agent", "team", "distillation"])
          .describe("Memory category"),
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
      description: "Search Hera's memory for stored information.",
      args: {
        query: z.string().describe("Search query"),
        category: z
          .enum(["session", "skill", "agent", "team", "distillation"])
          .optional()
          .describe("Filter by category"),
      },
      async execute(args) {
        const results = await memoryStore.search(args.query, args.category);
        if (results.length === 0) return "No matching memories found.";
        return results
          .slice(0, 10)
          .map((m) => `[${m.type}] ${m.content.slice(0, 200)}`)
          .join("\n---\n");
      },
    }),

    // === Distillation Tools ===

    "hera_distill_session": tool({
      description:
        "Distill the current session into structured knowledge: summary, decisions, patterns, and skills.",
      args: {
        session_id: z.string().describe("Session ID to distill"),
        skill_name: z
          .string()
          .optional()
          .describe("If provided, auto-create a skill from the distillation"),
      },
      async execute(args) {
        const result = await distillation.distillSession(args.session_id, [
          { role: "system", content: "Session distillation requested by Hera" },
        ]);

        if (args.skill_name) {
          const skill = await distillation.distillToSkill(
            args.skill_name,
            result
          );
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
