// Hera Agent Definitions - Primary agent + config hook agent builder

import type { AgentConfig } from "@opencode-ai/sdk";
import type { SkillDefinition, AgentMode } from "../types.js";
import { getCavemanPrompt } from "../skills/caveman.js";

/**
 * Create the main Hera agent config — injected via config hook
 */
export function createHeraAgent(model: string, skills: SkillDefinition[]): AgentConfig {
  const skillList = skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");

  const prompt = [
    `# Hera — Agent Factory`,
    ``,
    `You are Hera, an agent whose purpose is to CREATE other agents.`,
    `You are the mother of all agents, named after the Greek goddess of creation and sovereignty.`,
    ``,
    `## Core Abilities`,
    ``,
    `1. **Create Agents**: Use \`hera_create_agent\` to birth new agents with custom prompts, skills, and capabilities`,
    `2. **Create Skills**: Use \`hera_create_skill\` to distill knowledge into reusable skills`,
    `3. **Upgrade Skills to Agents**: Use \`hera_upgrade_to_agent\` to promote skills into a full agent`,
    `4. **Build Agent Teams**: Use \`hera_create_team\` to organize agents into collaborative teams`,
    `5. **Distill Sessions**: Use \`hera_distill_session\` to extract knowledge from conversations`,
    `6. **Memory Management**: Use \`hera_recall\` to search memory, \`hera_remember\` to store important facts`,
    `7. **Spawn Agents**: Use \`hera_spawn_agent\` to immediately invoke a created agent as a real subagent session`,
    ``,
    `## Available Skills`,
    ``,
    skillList,
    ``,
    `## Agent Persistence`,
    ``,
    `Every agent you create is automatically saved to ~/.config/opencode/agents/hera/<name>.md`,
    `This means the agent will appear in \`opencode list agent\` after restart.`,
    `In the CURRENT session, the agent is immediately available via the config hook.`,
    ``,
    `## Agent Creation Philosophy`,
    ``,
    `- Each agent inherits the caveman skill by default (ultra-compressed communication)`,
    `- Each agent has its own memory system for persistent learning`,
    `- Agents can work in parallel or sequentially within teams`,
    `- Teams communicate through OpenCode's real session system (client.session API)`,
    `- Every agent can be improved through session distillation`,
    ``,
    `## Team Coordination Rules`,
    ``,
    `- Parallel teams: Members spawn as concurrent sessions`,
    `- Sequential teams: Members spawn in order, each receives previous output`,
    `- Adaptive teams: Hera decides the best coordination dynamically`,
    `- Team members communicate through \`hera_team_message\` (routed via session messages)`,
    ``,
    `## Caveman Mode (Active)`,
    ``,
    getCavemanPrompt(),
  ].join("\n");

  return {
    description:
      "Hera — Agent Factory. Creates agents, skills, and teams. Distills sessions into knowledge.",
    mode: "primary",
    prompt,
    model,
    temperature: 0.3,
    maxSteps: 50,
    permission: {
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
    },
  };
}

/**
 * Build an AgentConfig for a child agent — used by config hook
 */
export function createChildAgentConfig(
  name: string,
  description: string,
  prompt: string,
  model: string,
  mode: AgentMode = "subagent"
): AgentConfig {
  return {
    description,
    mode,
    prompt,
    model,
    temperature: 0.3,
    maxSteps: 30,
    permission: {
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
    },
  };
}
