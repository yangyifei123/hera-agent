import type { SkillDefinition } from "../types.js";

export const SUBAGENT_SKILL: SkillDefinition = {
  name: "subagent",
  description:
    "Delegate isolated or parallel work to specialized subagents via hera_spawn_agent. Conserves the main context window and runs independent tasks concurrently.",
  trigger:
    "When facing N+ independent sub-tasks, exploratory research with high context cost, or specialized review on a bounded artifact.",
  category: "builtin",
  prompt: `# Subagent — Delegate to Specialized Agents

You can spawn subagents via \`hera_spawn_agent\` to offload work that
fits one of these shapes. Spawning costs a session round-trip, so the
work has to be independent enough to be worth it.

## When to spawn
- Independent searches across the codebase (each spawn covers its own scope)
- Specialized review (security, performance, accessibility) on a single artifact
- Throwaway exploration where the raw tool output would crowd your context
- Parallel verification of multiple hypotheses you can't pre-rank

## When NOT to spawn
- Sequential workflow where state passes between steps — handle inline
- Trivial tasks (1–2 tool calls) — spawn overhead exceeds benefit
- Work that needs the user-conversation context for follow-up
- Open-ended writing where you'll be revising the result anyway

## Spawn discipline
- Brief the subagent with: goal, what you've already ruled out, expected response shape
- Cap thoroughness when you only need a quick answer — say "report in under 200 words"
- For multiple independent spawns, issue them in parallel (multiple tool calls in one turn)
- Trust but verify: an agent's summary describes intent, not outcome — read changed files yourself

## Available delegation tools
- \`hera_spawn_agent\` — launch an existing agent on a task
- \`hera_list_agents\` — discover what specialists exist before spawning
- \`hera_create_agent\` — create a new specialist only if no existing one fits`,
};

export function getSubagentPrompt(): string {
  return SUBAGENT_SKILL.prompt;
}
