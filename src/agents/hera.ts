// Hera Agent Definitions - The main orchestrator agent and child agent factory

import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentFactory, SkillDefinition } from "../types.js";
import { getCavemanPrompt } from "../skills/caveman.js";

/**
 * Create the main Hera agent - the agent factory that creates other agents
 */
export function createHeraAgent(model: string, skills: SkillDefinition[]): AgentConfig {
  const skillList = skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");

  const prompt = [
    `# Hera — Agent Factory`,
    ``,
    `You are Hera, an agent whose purpose is to CREATE other agents. You are the mother of all agents.`,
    `Named after the Greek goddess of creation and sovereignty, you possess the unique ability to birth new agents,`,
    `equip them with skills, organize them into teams, and coordinate their collaboration.`,
    ``,
    `## Core Abilities`,
    ``,
    `1. **Create Agents**: Use \`hera_create_agent\` to birth new agents with custom prompts, skills, and capabilities`,
    `2. **Create Skills**: Use \`hera_create_skill\` to distill knowledge into reusable skills`,
    `3. **Upgrade Skills to Agents**: Use \`hera_upgrade_to_agent\` to promote one or more skills into a full agent`,
    `4. **Build Agent Teams**: Use \`hera_create_team\` to organize agents into collaborative teams`,
    `5. **Distill Sessions**: Use \`hera_distill_session\` to extract knowledge from conversations`,
    `6. **Memory Management**: Use \`hera_recall\` to search your memory, \`hera_remember\` to store important facts`,
    ``,
    `## Available Skills`,
    ``,
    skillList,
    ``,
    `## Agent Creation Philosophy`,
    ``,
    `- Each agent you create inherits the caveman skill by default (ultra-compressed communication)`,
    `- Each agent has its own memory system for persistent learning`,
    `- Agents can work in parallel or sequentially within teams`,
    `- Teams communicate through a shared message bus`,
    `- Every agent can be improved through session distillation`,
    ``,
    `## Team Coordination Rules`,
    ``,
    `- Parallel teams: Members work simultaneously, merge results`,
    `- Sequential teams: Members work in order, each builds on previous output`,
    `- Adaptive teams: Hera decides the best coordination dynamically`,
    `- All team members can send messages to each other via \`hera_team_message\``,
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
createHeraAgent.mode = "primary" as AgentMode;

/**
 * Create a child agent spawned by Hera
 */
export function createChildAgent(
  name: string,
  model: string,
  prompt: string,
  skills: SkillDefinition[],
  mode: AgentMode = "subagent"
): AgentConfig {
  const skillPrompts = skills
    .map((s) => `### Skill: ${s.name}\n${s.prompt}`)
    .join("\n\n");

  const fullPrompt = [
    `# Agent: ${name}`,
    ``,
    prompt,
    ``,
    `## Embedded Skills`,
    ``,
    skillPrompts,
    ``,
    `## Memory`,
    `You have persistent memory. Use \`hera_remember\` to store and \`hera_recall\` to retrieve.`,
    ``,
    `## Caveman Mode (Active)`,
    getCavemanPrompt(),
  ].join("\n");

  return {
    description: `Hera-spawned agent: ${name}`,
    mode,
    prompt: fullPrompt,
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
