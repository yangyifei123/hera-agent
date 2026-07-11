import type { AgentConfig } from "@opencode-ai/sdk";
import type {
  SkillDefinition,
  AgentMode,
  AgentDefinition,
  AgentTemplateName,
  AgentTemplate,
} from "../types.js";
import { DEFAULT_HERA_MAX_STEPS, DEFAULT_CHILD_MAX_STEPS, DEFAULT_SKILLS } from "../constants.js";
import { getDefaultPermission } from "../helpers.js";
import { getCavemanPrompt } from "../skills/caveman.js";
import { buildEvolutionBlock } from "../skills/evolution.js";
import { buildSkillManifestSection } from "../skills/manager.js";

export const AGENT_TEMPLATES: Record<AgentTemplateName, AgentTemplate> = {
  general: {
    name: "general",
    label: "General Assistant",
    description: "Versatile assistant for any task",
    defaultMode: "all",
    defaultSkills: [...DEFAULT_SKILLS],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a versatile AI assistant.`,
        `Adapt your approach to the task at hand.`,
        `Be concise, accurate, and helpful.`,
      ].join("\n"),
  },
  coder: {
    name: "coder",
    label: "Coding Expert",
    description: "Specialized in writing, debugging, and refactoring code",
    defaultMode: "all",
    defaultSkills: [...DEFAULT_SKILLS, "skill-combo"],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a senior software engineer.`,
        `Write clean, tested, maintainable code.`,
        `Follow project conventions and best practices.`,
        `Always verify your changes compile/run before reporting done.`,
      ].join("\n"),
  },
  reviewer: {
    name: "reviewer",
    label: "Code Reviewer",
    description: "Reviews code for quality, security, and maintainability",
    defaultMode: "subagent",
    defaultSkills: [...DEFAULT_SKILLS],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a code review specialist.`,
        `Focus on: security, performance, maintainability, correctness.`,
        `Provide actionable feedback with specific line references.`,
        `Rate severity: critical > warning > suggestion > nit.`,
      ].join("\n"),
  },
  researcher: {
    name: "researcher",
    label: "Research Analyst",
    description: "Researches solutions, libraries, patterns, and technical topics",
    defaultMode: "subagent",
    defaultSkills: [...DEFAULT_SKILLS, "skill-combo"],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a research analyst.`,
        `Investigate thoroughly before concluding.`,
        `Provide pros/cons, alternatives, and clear recommendations.`,
        `Cite sources when available.`,
      ].join("\n"),
  },
  coordinator: {
    name: "coordinator",
    label: "Team Coordinator",
    description: "Coordinates agent teams, distributes tasks, aggregates results",
    defaultMode: "all",
    defaultSkills: [...DEFAULT_SKILLS, "skill-combo"],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a team coordinator.`,
        `Break complex tasks into subtasks for team members.`,
        `Distribute work based on member specializations.`,
        `Aggregate results into coherent deliverables.`,
        `Track progress and handle failures gracefully.`,
      ].join("\n"),
  },
  architect: {
    name: "architect",
    label: "System Architect",
    description: "Designs system architecture, makes technical decisions",
    defaultMode: "all",
    defaultSkills: [...DEFAULT_SKILLS, "skill-combo"],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a system architect.`,
        `Design scalable, maintainable architectures.`,
        `Consider: performance, security, cost, maintainability.`,
        `Document decisions with rationale and tradeoffs.`,
        `Think long-term but deliver incrementally.`,
      ].join("\n"),
  },
  debugger: {
    name: "debugger",
    label: "Debug Specialist",
    description: "Investigates bugs, traces issues, proposes fixes",
    defaultMode: "all",
    defaultSkills: [...DEFAULT_SKILLS],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a debugging specialist.`,
        `Systematically investigate issues: reproduce, isolate, fix.`,
        `Use logs, stack traces, debugger tools.`,
        `Explain root cause and prevention strategy.`,
      ].join("\n"),
  },
  tester: {
    name: "tester",
    label: "Test Engineer",
    description: "Writes tests, ensures quality, finds edge cases",
    defaultMode: "subagent",
    defaultSkills: [...DEFAULT_SKILLS],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a test engineer.`,
        `Write comprehensive tests: unit, integration, e2e.`,
        `Think about edge cases, error paths, race conditions.`,
        `Ensure tests are fast, reliable, maintainable.`,
      ].join("\n"),
  },
  documenter: {
    name: "documenter",
    label: "Documentation Specialist",
    description: "Creates clear, comprehensive documentation",
    defaultMode: "subagent",
    defaultSkills: [...DEFAULT_SKILLS],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a documentation specialist.`,
        `Write clear, concise, accurate documentation.`,
        `Include: purpose, usage, examples, edge cases.`,
        `Keep docs in sync with code.`,
      ].join("\n"),
  },
  optimizer: {
    name: "optimizer",
    label: "Performance Optimizer",
    description: "Optimizes code for speed, memory, and efficiency",
    defaultMode: "subagent",
    defaultSkills: [...DEFAULT_SKILLS],
    promptFn: (name, customPrompt) =>
      customPrompt ||
      [
        `You are ${name}, a performance optimizer.`,
        `Profile first, optimize second.`,
        `Focus on bottlenecks, not micro-optimizations.`,
        `Measure impact before and after.`,
        `Balance performance vs maintainability.`,
      ].join("\n"),
  },
};

export function createHeraAgent(model: string, skills: SkillDefinition[]): AgentConfig {
  const skillList = skills
    .map((s) => `- **${s.name}** (${s.category}): ${s.description}`)
    .join("\n");

  const templateList = Object.values(AGENT_TEMPLATES)
    .map((t) => `- **${t.name}**: ${t.label} — ${t.description}`)
    .join("\n");

  const prompt = [
    `# Hera — Agent Factory`,
    ``,
    `You are Hera, an agent whose purpose is to CREATE other agents and agent teams.`,
    `Named after the Greek goddess of creation and sovereignty.`,
    ``,
    `## Core Abilities`,
    ``,
    `1. **Create Agents**: Use \`hera_create_agent\` — optionally from a template`,
    `2. **Create Skills**: Use \`hera_create_skill\` to distill knowledge into reusable skills`,
    `3. **Upgrade to Agent**: Use \`hera_upgrade_to_agent\` — skills → full agent`,
    `4. **Build Agent Teams**: Use \`hera_create_team\` — organize agents with roles`,
    `5. **Spawn Agents**: Use \`hera_spawn_agent\` — invoke agent as real OpenCode session`,
    `6. **Distill Sessions**: Use \`hera_distill_session\` — extract knowledge from conversations`,
    `7. **Evolve Agents**: Use \`hera_evolve_agent\` — append improvement directives`,
    `8. **Memory**: Use \`hera_remember\` / \`hera_recall\` — persistent knowledge store`,
    ``,
    `## Built-in Skills (inherited by all agents)`,
    ``,
    skillList,
    ``,
    `## Agent Templates`,
    ``,
    templateList,
    ``,
    `## Agent Persistence`,
    ``,
    `Every agent is saved to \`~/.config/opencode/agents/hera/<name>.md\`.`,
    `Available via \`opencode --agent <name>\` or \`@<name>\` after restart.`,
    `Immediately available in current session via the config hook.`,
    ``,
    `## Agent Creation Philosophy`,
    ``,
    `- All agents inherit: caveman, init, memory, evolution (non-removable)`,
    `- skill-combo added for complex agents (coder, researcher, coordinator)`,
    `- Each agent has persistent memory for learning across sessions`,
    `- Agents can self-evolve by appending directives after reflection`,
    `- Teams coordinate through real OpenCode sessions`,
    ``,
    `## Team Coordination`,
    ``,
    `- **parallel**: All members run simultaneously`,
    `- **sequential**: Chain — each receives previous output`,
    `- **adaptive**: First plans, rest execute in parallel`,
    ``,
    `## Caveman Mode (Active)`,
    ``,
    getCavemanPrompt(),
  ].join("\n");

  return {
    description:
      "Hera — Agent Factory. Creates agents, skills, teams. Distills sessions. Self-evolving.",
    mode: "primary",
    prompt,
    model,
    temperature: 0.3,
    maxSteps: DEFAULT_HERA_MAX_STEPS,
    permission: getDefaultPermission(),
  };
}

export function createChildAgentConfig(
  name: string,
  description: string,
  prompt: string,
  model: string,
  mode: AgentMode = "subagent",
  overrides?: {
    permission?: AgentConfig["permission"];
    tools?: Record<string, boolean>;
    maxSteps?: number;
  }
): AgentConfig {
  // Honor per-agent permission/tools/maxSteps so agent-level restrictions are
  // actually enforced at runtime (previously hardcoded → restrictions cosmetic).
  return {
    description,
    mode,
    prompt,
    model,
    temperature: 0.3,
    maxSteps: overrides?.maxSteps ?? DEFAULT_CHILD_MAX_STEPS,
    permission: overrides?.permission ?? getDefaultPermission(),
    ...(overrides?.tools ? { tools: overrides.tools } : {}),
  };
}

export function buildAgentPrompt(
  def: AgentDefinition,
  resolvedSkills: SkillDefinition[],
  opts: { loaderToolName?: string } = {}
): string {
  const sections: string[] = [];

  sections.push(`# Agent: ${def.name}`);
  sections.push("");
  sections.push(def.prompt);
  sections.push("");

  // Progressive disclosure (spec §5): compact manifest instead of full bodies.
  // The identical section is rendered by the live config hook and by exports;
  // src/agents/prompt-parity.test.ts pins the three paths together.
  const manifest = buildSkillManifestSection(
    resolvedSkills.map((s) => ({ name: s.name, description: s.description })),
    opts.loaderToolName
  );
  if (manifest) {
    sections.push(manifest);
    sections.push("");
  }

  if (def.evolutionLog && def.evolutionLog.length > 0) {
    sections.push(buildEvolutionBlock(def.evolutionLog));
    sections.push("");
  }

  return sections.join("\n");
}

export function createAgentFromTemplate(
  templateName: AgentTemplateName,
  agentName: string,
  customPrompt?: string,
  model?: string
): AgentDefinition {
  const tpl = AGENT_TEMPLATES[templateName];
  return {
    name: agentName,
    description: `${tpl.label} — ${tpl.description}`,
    mode: tpl.defaultMode,
    prompt: customPrompt ?? tpl.promptFn(agentName),
    model,
    // Dedupe: some templates list a skill (e.g. skill-combo) that is already in
    // DEFAULT_SKILLS, which would otherwise persist + render twice.
    skills: [...new Set(tpl.defaultSkills)],
    template: templateName,
    createdAt: Date.now(),
    evolutionLog: [],
  };
}
