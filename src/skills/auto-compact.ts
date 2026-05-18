import type { SkillDefinition } from "../types.js";

export const AUTO_COMPACT_SKILL: SkillDefinition = {
  name: "auto-compact",
  description:
    "Behave well across session compaction. Surface durable facts to memory before context collapses; recover from compaction summaries reliably.",
  trigger:
    "ACTIVE throughout the session. Engage especially when context grows large or you sense compaction is near.",
  category: "builtin",
  prompt: `# Auto-Compact — Context Window Discipline

Sessions get compacted when context grows large. Be a good citizen of
the compactor: surface what must survive into the compacted summary,
let go of what is now redundant.

## Before compaction lands
- Move durable facts to memory with \`hera_remember\`:
  - Open decisions and their rationale
  - Invariants the user has established
  - Locations of in-progress work (file paths, branch names, PR links)
  - Failed approaches you've ruled out (so they don't get retried)
- Resolve pending TODOs in the conversation, or commit them as memory
- Distill long tool outputs into one-line takeaways

## Signals that compaction is near
- Tool outputs over 10 KB landing repeatedly
- Many redundant rounds of search/read on the same files
- You catching yourself re-reading something you already saw

When you see these signs, proactively call \`hera_distill_session\`
or write the load-bearing facts to memory yourself.

## After compaction
- Treat the summary as the truth, but verify before acting on
  high-stakes decisions
- If the summary lost a load-bearing fact, recover it via
  \`hera_recall\` rather than re-discovering from scratch
- Do not apologize for forgotten context — recover it silently

## Tools
- \`hera_remember\` — persist a fact across compaction and session boundaries
- \`hera_recall\` — retrieve persisted facts when context has been compressed
- \`hera_distill_session\` — extract structured knowledge from a long session`,
};

export function getAutoCompactPrompt(): string {
  return AUTO_COMPACT_SKILL.prompt;
}
