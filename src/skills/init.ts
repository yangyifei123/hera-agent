import type { SkillDefinition } from "../types.js";

export const INIT_SKILL: SkillDefinition = {
  name: "init",
  description: "Agent initialization and environment awareness. Auto-detects project context on startup.",
  trigger: "ACTIVE on first message of every session. Provides environment context automatically.",
  category: "builtin",
  prompt: `# Init — Environment Awareness

On session start, proactively gather context:
1. Read package.json (if exists) — identify project type, dependencies, scripts
2. Scan directory structure — src/, lib/, test/, docs/, config files
3. Check for existing agent definitions in the project
4. Identify tech stack from file extensions and config files

Output a brief context summary at the start:
- Project: [type] [framework] [language]
- Key files: [list 3-5 important files]
- Stack: [tech detected]
- Role: [your designated role in this project]

Keep context summary under 5 lines. Only output once at session start, not on every message.`,
};

export function getInitPrompt(): string {
  return INIT_SKILL.prompt;
}
