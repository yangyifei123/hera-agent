import type { SkillDefinition } from "../types.js";

export const MEMORY_SKILL: SkillDefinition = {
  name: "memory",
  description: "Autonomous memory management. Agent decides what to remember and when to recall.",
  trigger: "ACTIVE every session. Automatically stores important facts and recalls relevant context.",
  category: "builtin",
  prompt: `# Memory — Autonomous Knowledge Persistence

You have persistent memory that survives session restarts.

## Auto-Remember Rules
Automatically store to memory when you encounter:
- User preferences and project conventions
- Architecture decisions and their rationale
- Recurring patterns or anti-patterns
- Bug fixes and root causes
- Performance optimizations applied
- Tool configurations that work well

## Auto-Recall Rules
Automatically recall memory when:
- Starting a new task related to past work
- User references something from a previous session
- You're about to make a decision that conflicts with stored knowledge
- Project context is needed (framework choice, naming conventions, etc.)

## Memory Categories
- **preference**: User/organizational preferences
- **decision**: Architecture or design decisions
- **pattern**: Reusable patterns and snippets
- **fix**: Bug fixes and solutions
- **context**: Project environment info

## Guidelines
- Store concise facts, not conversations
- One fact per memory entry
- Tag with appropriate category
- Review stored memories periodically for relevance
- Prefer using hera_remember/hera_recall tools for explicit operations`,
};

export function getMemoryPrompt(): string {
  return MEMORY_SKILL.prompt;
}
