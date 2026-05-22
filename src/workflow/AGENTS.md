# WORKFLOW KNOWLEDGE BASE

## OVERVIEW

`src/workflow/` owns Hera workflow orchestration: complexity scoring, serial/parallel/DAG execution, approval gates, progress callbacks, and templates.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Runtime execution | `manager.ts` | Creates workflows, executes steps, tracks history, talks to OpenCode client |
| Validation | `validator.ts` | Required IDs/names, cycles, dependencies, retry/timeout checks |
| Complexity scoring | `complexity-analyzer.ts` | Decides simple vs workflow-worthy tasks |
| Progress/concurrency | `progress.ts` | Progress callbacks and `ConcurrencyLimiter` |
| Step assignment | `auto-assign.ts` | Maps workflow steps to candidate agents |
| Templates | `templates.ts` | Built-in workflow definitions |
| Coverage | `*.test.ts` | Unit, smoke, stress, optimization, manager tests |

## CONVENTIONS

- `WorkflowStep.dependencies` is the current dependency field; older tests or docs may still say `dependsOn`.
- Validation rejects empty workflows and cycles before `WorkflowManager.createWorkflow()` persists anything.
- Keep approval flow explicit: `requireApproval` should pause/plan, not silently execute.
- Tests should use temp dirs or isolated MemoryStore paths; avoid repo-relative stress artifacts.

## ANTI-PATTERNS

- Do not return raw objects from OpenCode tool handlers unless the tool type contract supports them.
- Do not bypass `WorkflowValidator.validateOrThrow()` in create paths.
- OpenCode SDK calls return success/error envelopes; check `error`/`data`, and for session creation read `session.data?.id`.
- Do not widen workflow context with `Record<string, any>` unless narrowed at step boundaries.

## CURRENT STATUS

- Current validation (2026-05-21) passes `bun run format:check`, `bun run typecheck`, `bun run lint` (warnings only), `bun test`, and `bun run build`.
- Workflow creation rejects empty step lists and circular dependencies before persistence.
- Agent workflow steps use the current SDK session envelope: `session.create({ body, query })`, then `session.promptAsync({ path, body })`.

## TESTS

```bash
bun test src/workflow/validator.test.ts
bun test src/workflow/manager.test.ts
bun test src/workflow/smoke.test.ts
bun test src/workflow/stress.test.ts
bun test src/tools/workflow-tools.test.ts
```
