# TEAM KNOWLEDGE BASE

## OVERVIEW

`src/team/` owns persisted teams, inter-agent messages, real OpenCode session spawning, and optional management models.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Team state and spawning | `manager.ts` | `parallel`, `sequential`, `adaptive` coordination |
| Preset team shapes | `templates.ts` | Used by `hera_quick_team` |
| OKR mode | `okr-manager.ts` | Objectives and key result progress |
| Hierarchy mode | `tree-manager.ts` | Member tree formatting/building |
| Control mode | `control-manager.ts` | Checkpoints, gates, feedback controls |
| Tool surface | `../tools/team-tools.ts` | Public OpenCode tool handlers |

## CONVENTIONS

- Team definitions are stored as `team-<name>` MemoryStore entries.
- `spawnTeam()` must tolerate missing `client`; return local pending sessions instead of throwing.
- `sequential` coordination polls each session and passes accumulated prior output to the next member.
- `adaptive` uses the first member as planner, then fans out to remaining members.
- Messages use `{ from, to, teamName, kind }`; broadcast is represented by `to: "broadcast"`.

## ANTI-PATTERNS

- Do not simulate successful completion when no OpenCode client exists; keep pending/local status explicit.
- Do not block indefinitely polling sessions; use `TEAM_POLL_MAX_ATTEMPTS` and `TEAM_POLL_INTERVAL_MS`.
- Do not mutate team management arrays without re-saving the full team definition.
- Do not assume every team has objectives/control points; progress output must handle empty state.

## TESTS

```bash
bun test src/team/templates.test.ts
bun test src/team/okr-manager.test.ts
bun test src/team/tree-manager.test.ts
bun test src/team/control-manager.test.ts
bun test src/tools/team-tools.test.ts
```
