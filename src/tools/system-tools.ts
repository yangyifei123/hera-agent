import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";

const z = tool.schema;

export function createSystemTools(ctx: PluginContext) {
  const { store, skillManager, teamManager, agentRegistry, registeredAgents } = ctx;

  return {
    hera_status: tool({
      description: "Show Hera system status: agents, skills, teams, memory usage.",
      args: {},
      async execute() {
        const agents = Array.from(registeredAgents.keys());
        const skills = skillManager.getAllSkills();
        const teams = teamManager.getAllTeams();
        const memories = await store.list("agent");

        const diskAgents = await agentRegistry.listRegistered();
        const persistedCount = agents.filter(a => diskAgents.includes(a)).length;

        return [
          `# Hera System Status`,
          ``,
          `**Agents**: ${agents.length} total (${persistedCount} persisted, ${agents.length - persistedCount} session-only)`,
          `**Skills**: ${skills.length} (${skills.filter(s => s.category === "builtin").length} builtin, ${skills.filter(s => s.category === "user").length} user)`,
          `**Teams**: ${teams.length}`,
          `**Memory Entries**: ${memories.length}`,
          ``,
          `**Agent List**: ${agents.join(", ") || "none"}`,
          `**Skill List**: ${skills.map(s => s.name).join(", ")}`,
          `**Team List**: ${teams.map(t => t.name).join(", ") || "none"}`,
        ].join("\n");
      },
    }),
  };
}
