# HDTE P4 — Engine Modularization + Injection into Generated Agents/Teams

## Context

Final HDTE sub-project. P1–P3 built the durable task engine, four-mode loop
engine, and self-healing — all in `src/engine/*` + `src/store/*`, deliberately
self-contained (no imports from team/tools/index). Today only Hera itself wires
and runs the engine; agents/teams Hera **generates** as standalone OpenCode
plugins (via `plugin-generator.ts` / `team-plugin-generator.ts`) do not get it.

P4 makes the engine a **reusable runtime** that generated plugins bundle, per the
brainstorm decision ("共享 runtime 包依赖"). It also DRYs Hera's own wiring into a
single factory and adds a long-session compaction relay so durable work survives
context compaction.

## Locked decisions

1. **Shared runtime via a `hera-agent/engine` subpath export.** The engine is
   exposed through a `createEngine(...)` factory exported from a new
   `src/engine/index.ts` barrel, published as the `hera-agent` package's
   `./engine` export. Generated plugins depend on `hera-agent` and
   `import { createEngine } from "hera-agent/engine"`.
2. **One factory, both surfaces.** Hera's own `src/index.ts` and every generated
   plugin construct the engine through the same `createEngine` — single source of
   truth, no drift.
3. **Generated-plugin verification is static.** A generated plugin that depends on
   `hera-agent` cannot be `bun install`/run in this repo's test sandbox. Tests
   assert the generated **output** (package.json dependency + index wiring +
   exposed engine tools) and that the `hera-agent/engine` export builds — the same
   static-verification approach P1's generator regression test used.
4. **Compaction relay is context injection.** On `experimental.session.compacting`
   Hera injects a short summary of active tasks/loops into the retained context,
   so a long conversation stays aware of its durable work. The engine itself is
   process-level and already survives compaction; the relay is about agent
   awareness.

## Goal

`createEngine` wires the whole engine in one call. Hera and generated
agent/team plugins both use it. Generated plugins declare the `hera-agent`
dependency and expose the task/loop/recovery tools. Compaction injects active-work
context.

## Non-goals (deferred)

- End-to-end execution of a generated plugin (requires a published/installed
  `hera-agent`; out of this sandbox — verified statically + documented).
- Per-generated-plugin isolated data dirs / multi-tenant engine (generated
  plugins share Hera's `hera-data` like generated memory already does).
- New engine features (P4 is packaging + wiring only).

## Architecture

### `createEngine` factory (`src/engine/index.ts`)

```ts
export interface EngineOptions {
  dataDir: string;
  cwd: string;
  client: OpenCodeClient | undefined;
  config?: {
    task_concurrency?: number; task_lease_ms?: number; task_attempt_timeout_ms?: number;
    loop_tick_ms?: number; loop_default_max_iterations?: number;
    loop_min_interval_ms?: number; loop_max_consecutive_failures?: number;
  };
  ownerId?: string;
}
export interface Engine {
  taskStore: TaskStore; loopStore: LoopStore; loopManager: LoopManager;
  supervisor: Supervisor; executor: TaskExecutor; evaluator: AcceptanceEvaluator;
  tools: Record<string, unknown>; // task + loop + recovery tools
  init(): Promise<void>;   // init stores
  recover(): Promise<void>;// supervisor.recover + loopManager.recover
  start(): void;           // supervisor.start + loopManager.start
  stop(): void;
}
export function createEngine(opts: EngineOptions): Engine;
```

`createEngine` constructs every component with config-or-constant defaults,
builds the `OpenCodeAgentRunner` from the client, and assembles the engine tools
via a small `createEngineTools(engine)` that reuses the existing
`createTaskTools` / `createLoopTools` / `createRecoveryTools` against a minimal
context slice (they only need `taskStore`/`loopManager`/`supervisor`/
`teamManager?`). The barrel also re-exports the engine classes and types so
`hera-agent/engine` is a complete entry point.

> Tool reuse detail: `createTaskTools`/`createLoopTools`/`createRecoveryTools`
> currently take the full `PluginContext`. They only destructure a few fields.
> `createEngine` passes a structurally-typed object exposing exactly those fields
> (`taskStore`, `loopManager`, `supervisor`, and `teamManager` for recovery —
> generated plugins have no teams, so `hera_recover_sessions` is omitted there).

### Package export + build

`package.json`:
- `exports["./engine"] = { types: "./dist/engine/index.d.ts", import: "./dist/engine/index.js", default: "./dist/engine/index.js" }`.
- `build` script additionally bundles `src/engine/index.ts` → `dist/engine/index.js` and emits its `.d.ts`.

### Hera runtime refactor

`src/index.ts` replaces its hand-wired `TaskStore`/`AcceptanceEvaluator`/
`OpenCodeAgentRunner`/`TaskExecutor`/`Supervisor`/`LoopStore`/`LoopManager`
block with `const engine = createEngine({ dataDir: paths.dataDir, cwd:
paths.configRoot, client, config }); await engine.init(); await engine.recover();
engine.start();`. `PluginContext` gets `taskStore`/`loopManager`/`supervisor`
from `engine`. The merged tool map adds `engine.tools` (or `createAllTools`
continues to build task/loop/recovery tools from the ctx — keep whichever yields
identical tool names; prefer ctx-built to avoid double registration). Behavior
and tool names unchanged — gated by existing tests.

### Generated-plugin injection

`PluginGenerator.generate(agentDef, resolvedSkills, opts?: { withEngine?: boolean })`:
- When `withEngine` (default **true** for new generations):
  - `generatePackageJson` adds `"hera-agent": "^<currentVersion>"` to dependencies.
  - `generatePluginIndex` emits, inside the Plugin function, engine bootstrap:
    `import { createEngine } from "hera-agent/engine";` … `const engine =
    createEngine({ dataDir: getHeraDataDir(), cwd: getConfigRoot(), client:
    input.client }); await engine.init(); await engine.recover(); engine.start();`
    and spreads `...engine.tools` into the returned `tool: {}` alongside the
    existing memory tools.
- When `withEngine === false`: current behavior unchanged (back-compat).

`TeamPluginGenerator` gets the same `withEngine` treatment for its generated team
plugin index + package.json.

### Compaction relay

In `src/index.ts`'s `experimental.session.compacting` hook, after existing
distillation/auto-memory logic, append an **active-work summary** to the retained
context when the engine has live work:
`buildActiveWorkContext(taskStore, loopManager)` → a short block listing counts of
`pending`/`running` tasks and `active` loops (and up to N ids), e.g.
`"## Active durable work\nTasks: 3 pending, 2 running. Loops: 1 active
(recurring). These persist across this compaction; use hera_task_status /
hera_loop_status / hera_engine_health to inspect."`. Empty when there is no live
work. This function lives in `src/engine/active-work.ts` (pure, unit-testable).

## Testing

**Unit**
- `createEngine`: returns a wired `Engine` with non-empty `tools` containing the
  expected task/loop/recovery tool names; `init/recover/start/stop` callable;
  enqueuing via `engine.tools.hera_enqueue_task` + `engine.supervisor.drain()`
  completes a task (end-to-end through the factory).
- `buildActiveWorkContext`: empty string when no live work; includes task/loop
  counts and the inspect-tool hint when there are pending/running tasks or active
  loops.
- `plugin-generator` (static): with `withEngine`, the generated `package.json`
  dependencies include `hera-agent`; the generated `index.ts` contains
  `from "hera-agent/engine"`, `createEngine(`, `engine.start()`, and
  `...engine.tools`; with `withEngine: false`, none of those appear (back-compat).
- `team-plugin-generator` (static): same assertions for the team plugin output.
- Package export: a test asserts `package.json` `exports["./engine"]` exists and
  points at `dist/engine/index.js`.

**Integration / regression**
- Hera startup refactor: existing engine/loop/tools/index tests stay green; a test
  that constructs the ctx via `createEngine` exposes the same tool names as before.
- Build: `bun run build` produces `dist/engine/index.js` (+ `.d.ts`).

## Verification gate

```bash
bun run typecheck
bun run lint
bun run build   # must emit dist/engine/index.js
bun test
```

Generated-plugin runtime execution is out of sandbox — verified statically; record
this explicitly (not a silent gap).

## Risks and mitigations

- **Risk:** the Hera `index.ts` refactor changes runtime behavior/tool names.
  **Mitigation:** `createEngine` produces the identical components; gate on the
  full existing suite + a tool-name parity assertion.
- **Risk:** generated plugins can't be run here.
  **Mitigation:** static output assertions (the established generator-test
  pattern) + documented blocker; the `hera-agent/engine` export is build-verified.
- **Risk:** double tool registration (engine tools + ctx-built tools).
  **Mitigation:** build tools once; assert no duplicate tool names.
- **Risk:** generated plugin's engine shares Hera's `hera-data` and could conflict.
  **Mitigation:** same shared-pool model as generated memory (already shipped);
  tasks are id-namespaced; acceptable and documented.

## Done definition

P4 is done when: `createEngine` wires the full engine in one call and is exported
as `hera-agent/engine` (build-verified); Hera's runtime uses it with no behavior/
tool-name change; `plugin-generator` and `team-plugin-generator` inject the engine
(dependency + wiring + tools) under `withEngine`, statically verified;
compaction injects an active-work summary; the gate passes or blockers are
recorded.
