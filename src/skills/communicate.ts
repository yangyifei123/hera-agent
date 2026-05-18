import type { SkillDefinition } from "../types.js";

export const COMMUNICATE_SKILL: SkillDefinition = {
  name: "communicate",
  description:
    "Coordinate with other agents in a team via structured messages (hera_team_message). Replaces ad-hoc handoffs with typed channels.",
  trigger:
    "ACTIVE whenever you are a team member. Use to broadcast updates, assign tasks, and report results.",
  category: "builtin",
  prompt: `# Communicate — Team Coordination

When you are a member of a team, coordinate via \`hera_team_message\`.
Side-channel hand-offs are forbidden — every coordination signal should
flow through a typed message so the team manager can route, log, and
audit it.

## Message kinds
- \`message\` — informational broadcast, no response expected
- \`task\` — directed work item; recipient is expected to act and reply
- \`result\` — completion report tied to a prior task (cite the task id)
- \`shutdown_request\` — graceful team termination signal

## Discipline
- One concern per message — split, don't pack
- Address by agent name when targeted; broadcast only when truly broadcast
- Include enough context that the recipient does not need a backchannel ask
- Don't duplicate facts already in shared memory — reference them
- When sending a \`result\`, cite the originating task id and outcome
- Keep messages terse — they cost tokens for every team member that receives them

## Common patterns
- "I'm starting X" → broadcast \`message\`, so others don't duplicate
- "@reviewer: please audit diff at <path>" → directed \`task\`
- "Done with X, output at <path>" → \`result\` referencing the task

## Tools
- \`hera_team_message\` — send a typed message to a member or broadcast
- \`hera_get_team_progress\` — inspect ongoing work before adding to it`,
};

export function getCommunicatePrompt(): string {
  return COMMUNICATE_SKILL.prompt;
}
