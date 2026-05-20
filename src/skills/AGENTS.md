# SKILLS KNOWLEDGE BASE

## OVERVIEW

`src/skills/` defines built-in agent skills and manages user-created skill packages stored on disk.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Built-in skill list | `manager.ts` | `BUILTIN_SKILLS` includes caveman/init/skill-combo/memory/evolution/subagent/communicate/auto-compact |
| Skill package CRUD | `manager.ts` | Disk format: `SKILL.json`, `SKILL.md`, optional `config.json`, extra files |
| Capability analysis | `analyzer.ts` | Used for skill upgrade/decomposition support |
| Delegation skill | `subagent.ts` | Teaches child agents to use `hera_spawn_agent` |
| Team messaging skill | `communicate.ts` | Teaches structured `hera_team_message` coordination |
| Compaction discipline | `auto-compact.ts` | Memory/context survival instructions |
| Tests | `*.test.ts` | Manager, analyzer, and new built-ins have focused tests |

## CONVENTIONS

- Built-ins are loaded before stored skills.
- Legacy `SkillDefinition` entries from MemoryStore are still accepted.
- Disk packages are directories under `hera-data/skills/<name>/`.
- `normalizePath()` converts package extra file paths to forward slashes.
- `packageToDefinition()` preserves backward compatibility for callers expecting `SkillDefinition`.

## ANTI-PATTERNS

- Do not delete or overwrite built-in skill semantics; `deleteSkill()` must return false for built-ins.
- Do not include auto-generated files (`SKILL.json`, `SKILL.md`, `config.json`) in package `files[]`.
- Do not drop MemoryStore writes when creating skills; they are fallback persistence.
- Do not make user skill loading fatal; corrupted entries are skipped by design.

## TESTS

```bash
bun test src/skills/manager.test.ts
bun test src/skills/analyzer.test.ts
bun test src/skills/subagent.test.ts
bun test src/skills/communicate.test.ts
bun test src/skills/auto-compact.test.ts
```
