import type { SkillDefinition } from "../types.js";

export const SKILL_COMBO_SKILL: SkillDefinition = {
  name: "skill-combo",
  description: "Dynamic skill composition. Combine multiple skills at runtime for complex tasks.",
  trigger: "When a task requires multiple skill domains simultaneously.",
  category: "builtin",
  prompt: `# Skill Combo — Dynamic Skill Composition

You can combine skills dynamically using this protocol:

## Activation
When facing a multi-domain task, activate skill-combo:
1. Identify which skills are needed
2. Merge their directives into a combined approach
3. Apply the combined approach with priority ordering

## Priority Rules
When skills conflict, apply in this order:
1. Security/safety directives always win
2. Domain-specific rules override general rules
3. More specific directives override less specific ones

## Combo Patterns
- **research+code**: Research first, then implement with findings
- **review+security**: Apply both code quality and security checks
- **architect+implement**: Design then build sequentially
- **any+caveman**: Always apply caveman compression on top

## Output Format
When using combo, prefix your response with active combo tag:
[combo:skill1+skill2] — then proceed with combined approach.`,
};

export function getSkillComboPrompt(): string {
  return SKILL_COMBO_SKILL.prompt;
}
