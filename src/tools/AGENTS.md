# TOOLS KNOWLEDGE BASE

## OVERVIEW

`src/tools/` exposes Hera's OpenCode tools. Each file owns one domain; `index.ts` only merges factories.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Register every tool | `index.ts` | Spread domain maps in final tool object |
| Agent lifecycle | `agent-tools.ts` | Create/list/delete/spawn/export/import/restore/quickstart |
| Skill lifecycle | `skill-tools.ts` | Create/list/delete/analyze/decompose/upgrade to agent/team |
| Skill -> team helper | `skill-to-team.ts` | Creates member agents and team from skills |
| Team lifecycle | `team-tools.ts` | Create/spawn/message/management/export/progress |
| Memory tools | `memory-tools.ts` | `hera_remember`, `hera_recall` |
| Evolution/distillation | `evolution-tools.ts` | Evolve/list/rollback/distill/propose |
| System tools | `system-tools.ts` | Status/onboarding |
| Tests | `*-tools.test.ts`, `test-harness.ts` | Use shared PluginContext factory |

## CONVENTIONS

- Tool args use `tool.schema` zod-like schema from `@opencode-ai/plugin`.
- Tool results are strings; preserve return type compatibility.
- Validate agent names before any path-using file operation.
- For agent writes/deletes, call `persistAgent()` / `removeAgent()`; do not duplicate triple persistence.
- Keep tool descriptions stable unless changing public API intentionally.

## ANTI-PATTERNS

- Do not auto-execute suggested actions from error messages.
- Do not create teams with missing agents unless using the explicit quick/team-upgrade path.
- Do not remove `tools/index.ts`; other code imports the barrel.
- Do not make tool tests depend on a real OpenCode client; use the harness/fakes.

## TESTS

```bash
bun test src/tools/agent-tools.test.ts
bun test src/tools/team-tools.test.ts
bun test src/tools/skill-to-team.test.ts
```
