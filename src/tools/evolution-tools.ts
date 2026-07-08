import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import { proposeEvolution } from "../evolution/auto-evolve.js";
import { fetchSessionMessages } from "../memory/session-messages.js";
import { validateSkillName } from "../validation.js";
import { errorMessage } from "../helpers.js";

const z = tool.schema;

export function createEvolutionTools(ctx: PluginContext) {
  const { agentRegistry, registeredAgents, store, skillManager } = ctx;

  return {
    hera_evolve_agent: tool({
      description:
        "Append an evolution directive to an agent. Agent will self-improve based on reflection.",
      args: {
        name: z.string().describe("Agent name"),
        trigger: z.string().describe("What triggered this evolution"),
        observation: z.string().describe("What was observed"),
        directive: z.string().describe("New rule to add"),
      },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def)
          return `Error: Agent "${args.name}" not found. Use hera_list_agents to see available agents.`;
        if (!def.evolutionLog) def.evolutionLog = [];
        const entry = {
          timestamp: Date.now(),
          trigger: args.trigger,
          observation: args.observation,
          directive: args.directive,
          rolledBack: false,
        };
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
        if (!def)
          return `Error: Agent "${args.name}" not found. Use hera_list_agents to see available agents.`;
        if (!def.evolutionLog || def.evolutionLog.length === 0)
          return `Agent "${args.name}" has no evolution history.`;
        return def.evolutionLog
          .map((e, i) => {
            const status = e.rolledBack ? "[ROLLED BACK]" : "[ACTIVE]";
            return `${i + 1}. ${status} [${new Date(e.timestamp).toISOString()}] Trigger: ${e.trigger}\n   Directive: ${e.directive}`;
          })
          .join("\n\n");
      },
    }),

    hera_rollback_evolution: tool({
      description: "Rollback the latest evolution directive for an agent.",
      args: { name: z.string().describe("Agent name") },
      async execute(args) {
        const def = registeredAgents.get(args.name);
        if (!def)
          return `Error: Agent "${args.name}" not found. Use hera_list_agents to see available agents.`;
        if (!def.evolutionLog || def.evolutionLog.length === 0)
          return `Agent "${args.name}" has no evolution history.`;
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

    hera_distill_session: tool({
      description: "Distill a session into structured knowledge. Optionally auto-create a skill.",
      args: {
        session_id: z.string().describe("Session ID"),
        skill_name: z.string().optional().describe("Auto-create skill from distillation"),
      },
      async execute(args) {
        const { distillation, client } = ctx;

        // Validate the skill name up front so we never distill+persist against an
        // invalid name (previously the distilled skill was written before the
        // name was checked, leaving a ghost entry).
        if (args.skill_name) {
          const nameCheck = validateSkillName(args.skill_name);
          if (!nameCheck.valid) {
            return `Error: invalid skill name "${args.skill_name}": ${nameCheck.error}`;
          }
        }

        // Fetch real session messages. If none are available, do NOT fabricate a
        // placeholder and report success — that persisted a garbage distillation
        // (and skill). Surface the failure so the caller knows nothing was saved.
        const messages = await fetchSessionMessages(client, args.session_id);
        if (messages.length === 0) {
          return `Error: no messages found for session "${args.session_id}". The session may not exist or the client is unavailable — nothing was distilled.`;
        }

        const result = await distillation.distillSession(args.session_id, messages);
        if (args.skill_name) {
          const skill = distillation.distillToSkill(args.skill_name, result);
          try {
            await skillManager.createSkill(skill);
          } catch (err: unknown) {
            return `Session distilled, but creating skill "${args.skill_name}" failed: ${errorMessage(err)}`;
          }
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

    hera_propose_evolution: tool({
      description:
        "Analyze a failure and propose an evolution directive for an agent. Does NOT auto-apply — use hera_evolve_agent to apply.",
      args: {
        agent_name: z.string().describe("Agent name to propose evolution for"),
        failure_description: z.string().describe("Description of the failure or error encountered"),
      },
      async execute(args) {
        const def = registeredAgents.get(args.agent_name);
        if (!def)
          return `Error: Agent "${args.agent_name}" not found. Use hera_list_agents to see available agents.`;

        const proposal = proposeEvolution(args.failure_description);
        if (!proposal) {
          return `No known failure pattern matched "${args.failure_description.slice(0, 50)}...". No evolution proposed.`;
        }

        return [
          `**Proposed evolution for "${args.agent_name}":**`,
          ``,
          `**Trigger:** ${proposal.trigger}`,
          `**Observation:** ${proposal.observation}`,
          `**Directive:** ${proposal.directive}`,
          ``,
          `To apply, run:`,
          `  hera_evolve_agent(name="${args.agent_name}", trigger="${proposal.trigger}", observation="${proposal.observation}", directive="${proposal.directive}")`,
        ].join("\n");
      },
    }),
  };
}
