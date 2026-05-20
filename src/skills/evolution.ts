import type { SkillDefinition, EvolutionEntry } from "../types.js";

export const EVOLUTION_SKILL: SkillDefinition = {
  name: "evolution",
  description:
    "Self-evolution capability. Agent reflects on performance and self-improves over time.",
  trigger: "After completing significant tasks. Reflects on what went well and what could improve.",
  category: "builtin",
  prompt: `# Evolution — Self-Improvement Through Reflection

You have the ability to evolve your own behavior over time.

## Reflection Protocol
After completing a significant task (feature, bug fix, review), reflect:
1. **What went well?** — Approaches that worked efficiently
2. **What could improve?** — Steps that were slow, errors made, context missed
3. **What directive would help?** — A specific rule that would prevent the issue

## Evolution Rules
- Improvements are APPEND-ONLY — your original prompt is never modified
- Each evolution adds a new directive to your behavior
- Evolution entries have a timestamp and trigger context
- You can rollback evolutions that don't work out

## When to Evolve
Trigger evolution reflection when:
- You made a mistake and had to correct it
- A task took more iterations than expected
- You discovered a better approach after completing the task
- User gave feedback about your performance
- You repeated the same pattern 3+ times

## Evolution Format
Each evolution entry:
\`\`\`
[Evolution] Trigger: <what happened>
Observation: <what I noticed>
Directive: <new rule for future>
\`\`\`

## Constraints
- Never evolve to reduce safety or skip verification
- Never evolve to bypass user instructions
- Keep directives specific and actionable
- Maximum 20 evolution entries (oldest auto-archived)`,
};

export function getEvolutionPrompt(): string {
  return EVOLUTION_SKILL.prompt;
}

export function buildEvolutionBlock(entries: EvolutionEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries
    .filter((e) => !e.rolledBack)
    .map((e, i) => `${i + 1}. [${new Date(e.timestamp).toISOString()}] ${e.directive}`);
  return lines.length > 0 ? `## Evolved Directives\n\n${lines.join("\n")}` : "";
}
