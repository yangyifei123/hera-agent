import { tool } from "@opencode-ai/plugin";
import type { PluginContext, AgentDefinition } from "../types.js";
import { MAX_RESULT_PREVIEW_LENGTH } from "../constants.js";
import { TEAM_TEMPLATES, type TeamTemplateName } from "../team/templates.js";
import { createAgentFromTemplate } from "../agents/hera.js";
import { persistAgent } from "../persistence.js";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  createObjective as okrCreateObjective,
  createKeyResult,
  updateKeyResult as okrUpdateKeyResult,
  calculateProgress,
  calculateTeamProgress,
  formatTeamProgress,
} from "../team/okr-manager.js";
import {
  buildHierarchy,
  formatTree as formatTreeHierarchy,
} from "../team/tree-manager.js";
import {
  createControlPoint,
  addControlPoint,
  formatControlPoints,
} from "../team/control-manager.js";

const z = tool.schema;

export function createTeamTools(ctx: PluginContext) {
  const { teamManager, store, registeredAgents, client, skillManager, agentRegistry, paths } = ctx;

  return {
    hera_create_team: tool({
      description: "Create an agent team with real OpenCode session members.",
      args: {
        name: z.string().describe("Team name"),
        description: z.string().describe("Team purpose"),
        coordination: z.enum(["parallel", "sequential", "adaptive"]).describe("Coordination mode"),
        management: z.enum(["simple", "okr", "tree", "control"]).optional().describe("Management mode (default: simple)"),
        members: z.array(z.object({
          agent_name: z.string().describe("Agent name (must be created first)"),
          role: z.string().describe("Member role"),
        })).describe("Team members"),
      },
      async execute(args) {
        const missing = args.members.filter((m) => !registeredAgents.has(m.agent_name));
        if (missing.length > 0) {
          return `Error: Agents ${missing.map((m) => m.agent_name).join(", ")} don't exist yet. Create them first with hera_create_agent, or use hera_quick_team for auto-creation.`;
        }
        const team = {
          name: args.name,
          description: args.description,
          coordination: args.coordination,
          management: args.management ?? "simple",
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
        return ok ? `Team "${args.name}" deleted.` : `Team "${args.name}" not found. Use hera_list_teams to see available teams.`;
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
            `- ${s.agentName}: ${s.status} (session: ${s.sessionId})${s.result ? `\n  Result: ${s.result.slice(0, MAX_RESULT_PREVIEW_LENGTH)}` : ""}`
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
        if (!team) return `Error: Team "${args.team_name}" not found. Use hera_list_teams to see available teams. If missing, create it with hera_create_team.`;
        const memberNames = team.members.map((m) => m.agentName);
        if (!memberNames.includes(args.from)) return `Error: "${args.from}" is not a member of "${args.team_name}". Current members: ${memberNames.join(", ")}. Use hera_create_team to update membership.`;
        const msg = teamManager.sendMessage(args.team_name, args.from, args.to, args.content, (args.kind as any) ?? "message");
        return `Message sent from ${args.from} to ${args.to} in ${args.team_name}. ID: ${msg.id}`;
      },
    }),

    hera_quick_team: tool({
      description: "One-command team creation with auto-generated members from a template. Auto-creates missing agents, creates the team, and optionally spawns a task.",
      args: {
        name: z.string().describe("Team name (lowercase, hyphens OK)"),
        template: z.enum(["code-review", "dev-pipeline", "research"]).describe("Team template"),
        task_description: z.string().optional().describe("Task to execute immediately after team creation"),
      },
      async execute(args, ctx) {
        const tpl = TEAM_TEMPLATES[args.template];
        if (!tpl) {
          return `Error: Unknown team template "${args.template}". Available: ${Object.keys(TEAM_TEMPLATES).join(", ")}.`;
        }

        // Auto-create missing agents
        const creationResults: string[] = [];
        for (const member of tpl.members) {
          if (!registeredAgents.has(member.role)) {
            try {
              const agentDef = createAgentFromTemplate(member.template, member.role);
              const skillsMap = skillManager.getSkillMap();
              const { fileWritten } = await persistAgent(agentDef, skillsMap, registeredAgents, agentRegistry, store);
              creationResults.push(`+ Created agent "${member.role}" (template: ${member.template}) → ${fileWritten}`);
            } catch (err: any) {
              creationResults.push(`✗ Failed to create agent "${member.role}": ${err?.message ?? String(err)}`);
            }
          } else {
            creationResults.push(`✓ Agent "${member.role}" already exists`);
          }
        }

        // Create team
        const team = {
          name: args.name,
          description: tpl.description,
          coordination: tpl.coordination,
          members: tpl.members.map((m) => ({
            agentName: m.role,
            role: m.role,
            subscriptions: ["message", "task", "result"],
            backendType: "in-process" as const,
          })),
          sharedMemory: [],
          createdAt: Date.now(),
        };
        await teamManager.createTeam(team);

        const lines = [
          `Team "${args.name}" created (template: ${args.template}).`,
          `Coordination: ${tpl.coordination}. Members: ${tpl.members.map((m) => m.role).join(", ")}.`,
          ``,
          `Agent setup:`,
          ...creationResults.map((r) => `  ${r}`),
        ];

        // Optionally spawn task
        if (args.task_description) {
          try {
            const hasClient = client && typeof client.session?.create === "function";
            if (hasClient) {
              const sessions = await teamManager.spawnTeam(args.name, args.task_description, ctx.sessionID, ctx.directory);
              lines.push(``, `Task spawned: "${args.task_description}"`);
              for (const s of sessions) {
                lines.push(`  - ${s.agentName}: ${s.status} (session: ${s.sessionId})`);
              }
            } else {
              lines.push(``, `Note: No session client available. Team created but task not spawned.`);
            }
          } catch (err: any) {
            lines.push(``, `Task spawn failed: ${err?.message ?? String(err)}`);
          }
        }

        return lines.join("\n");
      },
    }),

    hera_add_objective: tool({
      description: "Add an objective to a team (for okr/tree/control management modes).",
      args: {
        team_name: z.string().describe("Team name"),
        objective: z.string().describe("Objective description"),
        key_results: z.array(z.object({
          description: z.string().describe("Key result description"),
          target: z.number().describe("Target value"),
          metric: z.string().describe("Unit of measurement"),
        })).optional().describe("Key results for this objective"),
        assignee: z.string().optional().describe("Agent assigned to this objective"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) return `Error: Team "${args.team_name}" not found. Use hera_list_teams to see available teams.`;

        const krs = (args.key_results ?? []).map((kr) =>
          createKeyResult(kr.description, kr.target, kr.metric)
        );
        const objective = okrCreateObjective(args.objective, krs, args.assignee);

        const objectives = [...(team.objectives ?? []), objective];
        await teamManager.createTeam({ ...team, objectives });

        const krSummary = krs.length > 0
          ? krs.map((kr) => `  - ${kr.description}: 0/${kr.target} ${kr.metric}`).join("\n")
          : "  (no key results defined)";
        return [
          `Objective "${args.objective}" added to team "${args.team_name}".`,
          `Objective ID: ${objective.id}`,
          `Key Results:`,
          krSummary,
        ].join("\n");
      },
    }),

    hera_update_key_result: tool({
      description: "Update progress on a key result within a team objective (for okr management mode).",
      args: {
        team_name: z.string().describe("Team name"),
        objective_id: z.string().describe("Objective ID"),
        kr_id: z.string().describe("Key result ID"),
        progress: z.number().min(0).describe("New current value for the key result"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) return `Error: Team "${args.team_name}" not found. Use hera_list_teams to see available teams.`;

        const objectives = team.objectives ?? [];
        const objIndex = objectives.findIndex((o) => o.id === args.objective_id);
        if (objIndex === -1) return `Error: Objective "${args.objective_id}" not found in team "${args.team_name}".`;

        try {
          const updatedObj = okrUpdateKeyResult(objectives[objIndex], args.kr_id, args.progress);
          const newObjectives = objectives.map((o, i) => i === objIndex ? updatedObj : o);
          await teamManager.createTeam({ ...team, objectives: newObjectives });

          const kr = updatedObj.keyResults.find((k) => k.id === args.kr_id);
          const pct = kr && kr.target > 0 ? Math.round((kr.current / kr.target) * 100) : 0;
          return `Key result "${args.kr_id}" updated to ${args.progress} (${pct}%) under objective "${args.objective_id}" for team "${args.team_name}".`;
        } catch (err: any) {
          return `Error: ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_add_control_point: tool({
      description: "Add a control point to a team (for control management mode).",
      args: {
        team_name: z.string().describe("Team name"),
        control_point: z.string().describe("Control point name"),
        type: z.enum(["checkpoint", "gate", "feedback"]).optional().describe("Control point type (default: checkpoint)"),
        condition: z.string().optional().describe("Condition to evaluate (e.g., 'coverage>80')"),
        action: z.enum(["approve", "reject", "escalate"]).optional().describe("Action on pass (default: approve)"),
        reviewer: z.string().optional().describe("Reviewer agent name"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) return `Error: Team "${args.team_name}" not found. Use hera_list_teams to see available teams.`;

        const cp = createControlPoint(
          args.control_point,
          args.type ?? "checkpoint",
          args.condition ?? "true",
          args.action ?? "approve",
          args.reviewer,
        );

        const existingPoints = team.controlPoints ?? [];
        try {
          const controlPoints = addControlPoint(existingPoints, cp);
          await teamManager.createTeam({ ...team, controlPoints });
          return `Control point "${args.control_point}" (${cp.type}) added to team "${args.team_name}". ID: ${cp.id}`;
        } catch (err: any) {
          return `Error: ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_export_team: tool({
      description: "Export an existing team as a standalone OpenCode plugin. Generates a package that registers all member agents under one plugin, sharing Hera's memory pool. Set auto_install to skip manual build/add steps.",
      args: {
        team_name: z.string().describe("Team name to export"),
        auto_install: z.boolean().optional().describe("When true, run bun install/build/add automatically"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) {
          return `Error: Team "${args.team_name}" not found. Use hera_list_teams to see available teams.`;
        }

        // Resolve member agent definitions — prefer the in-memory map, fall
        // back to reading the .md from disk.
        const memberDefs: AgentDefinition[] = [];
        const missing: string[] = [];
        for (const m of team.members) {
          const def =
            registeredAgents.get(m.agentName) ??
            (await agentRegistry.readDefinition(m.agentName));
          if (def) memberDefs.push(def);
          else missing.push(m.agentName);
        }
        if (missing.length > 0) {
          return `Error: Member agent(s) missing from registry/disk: ${missing.join(", ")}. Create them first.`;
        }

        let TeamGenMod: any;
        try {
          TeamGenMod = await import("../generators/team-plugin-generator.js");
        } catch (err: any) {
          return `Error: TeamPluginGenerator unavailable: ${err?.message ?? String(err)}`;
        }

        const generator = new TeamGenMod.TeamPluginGenerator();
        const generatedDir = join(paths.configRoot, "agents", "hera-generated");
        await mkdir(generatedDir, { recursive: true });
        const pluginDir = join(generatedDir, `${args.team_name}-team`);

        // Resolve skills for prompt embedding (additional user skills only;
        // built-ins are always embedded by buildAgentPrompt).
        const skillMap = skillManager.getSkillMap();
        const skillNames = new Set<string>();
        for (const def of memberDefs) for (const s of def.skills) skillNames.add(s);
        const resolvedSkills = Array.from(skillNames)
          .map((n) => skillMap.get(n))
          .filter(Boolean);

        try {
          const pkg = generator.generate(team, memberDefs, resolvedSkills);
          await generator.writeToDisk(pkg, pluginDir);

          if (args.auto_install === true) {
            const result = await generator.installWithBuild(pluginDir, paths.configRoot);
            if (result.ok) {
              return [
                `Team "${args.team_name}" exported and installed as plugin.`,
                `Plugin directory: ${pluginDir}`,
                `Members registered: ${memberDefs.map((d) => d.name).join(", ")}.`,
                ``,
                `Restart OpenCode to load the new plugin.`,
              ].join("\n");
            }
            const failed = result.steps.find((s: any) => !s.ok);
            return [
              `Team "${args.team_name}" exported but auto-install failed at step: ${failed?.name ?? "unknown"}.`,
              `Plugin directory: ${pluginDir}`,
              failed?.stderr ? `Error: ${failed.stderr.slice(0, 500)}` : "",
              ``,
              `Manual fallback:`,
              `1. cd ${pluginDir} && bun install && bun run build`,
              `2. cd ~/.config/opencode && bun add file://${pluginDir}`,
            ].filter(Boolean).join("\n");
          }

          return [
            `Team "${args.team_name}" exported as plugin.`,
            `Plugin directory: ${pluginDir}`,
            `Members: ${memberDefs.map((d) => d.name).join(", ")}.`,
            ``,
            `Next steps:`,
            `1. cd ${pluginDir} && bun install && bun run build`,
            `2. cd ~/.config/opencode && bun add file://${pluginDir}`,
          ].join("\n");
        } catch (err: any) {
          return `Error generating team plugin for "${args.team_name}": ${err?.message ?? String(err)}`;
        }
      },
    }),

    hera_get_team_progress: tool({
      description: "Get team info and progress overview.",
      args: {
        team_name: z.string().describe("Team name"),
      },
      async execute(args) {
        const team = teamManager.getTeam(args.team_name);
        if (!team) return `Error: Team "${args.team_name}" not found. Use hera_list_teams to see available teams.`;
        const members = team.members.map((m) => `${m.agentName}(${m.role})`).join(", ");

        const lines = [
          `Team: **${team.name}**`,
          `Description: ${team.description}`,
          `Coordination: ${team.coordination}`,
          `Management: ${team.management ?? "simple"}`,
          `Members: ${members}`,
        ];

        // OKR progress
        if (team.objectives && team.objectives.length > 0) {
          lines.push("", formatTeamProgress(team.objectives));
        }

        // Tree hierarchy
        if (team.management === "tree" && team.members.length > 0) {
          const tree = buildHierarchy(team.members.map((m) => ({ agentName: m.agentName, role: m.role })));
          lines.push("", "## Hierarchy", formatTreeHierarchy(tree));
        }

        // Control points
        if (team.controlPoints && team.controlPoints.length > 0) {
          lines.push("", "## Control Points", formatControlPoints(team.controlPoints));
        }

        if ((!team.objectives || team.objectives.length === 0) && (!team.controlPoints || team.controlPoints.length === 0)) {
          lines.push("Progress: No objectives or control points defined yet.");
        }

        return lines.join("\n");
      },
    }),
  };
}
