# HDTE P4 — Engine Modularization + Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the HDTE engine as a one-call `createEngine` factory published at `hera-agent/engine`, refactor Hera to use it, inject it into generated agent/team plugins, and relay active-work context across compaction.

**Architecture:** A `src/engine/index.ts` barrel exports `createEngine(opts)` (wires TaskStore + LoopStore + AcceptanceEvaluator + executor + supervisor + loopManager + the task/loop/recovery tools). `package.json` adds a `./engine` export. The generators inject `createEngine` wiring into generated plugins. A pure `buildActiveWorkContext` feeds the compaction hook.

**Tech Stack:** TypeScript, Bun (`bun:test`), `@opencode-ai/plugin`.

## Global Constraints

- The engine stays self-contained: `src/engine/*` must not import from `src/index.ts`. `createEngine` may import the existing tool factories (`createTaskTools`/`createLoopTools`/`createRecoveryTools`) since those only destructure a few ctx fields.
- Generated-plugin tests are STATIC (assert generated source/package.json), not runtime — a generated plugin depending on `hera-agent` can't be installed in this sandbox. Record this explicitly; do not claim runtime verification.
- Hera's own runtime behavior and tool NAMES must be unchanged after the refactor — gate on the full existing suite.
- `withEngine` defaults to true for new generations; `withEngine: false` preserves current generator output exactly (back-compat).
- `heraLog()` never `console.*`; constants from `src/constants.ts`. Tests next to source. Windows: judge `bun test` by bun's "N pass, M fail" line; run git/shell via PowerShell. Commit bodies end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- After any task, if `bun run lint` shows CRLF `prettier/prettier` errors from new files, run `bun run lint:fix` and include the normalization (formatting-only) in the commit.

---

### Task 1: `createEngine` factory + barrel + package export

**Files:**
- Create: `src/engine/index.ts`
- Modify: `package.json` (`exports["./engine"]`, build script bundles the engine)
- Test: `src/engine/create-engine.test.ts`

**Interfaces:**
- Consumes: all engine classes (P1–P3), `createTaskTools`/`createLoopTools`/`createRecoveryTools`, `getDefaultPermission`, constants.
- Produces: `createEngine(opts: EngineOptions): Engine` and re-exports of the engine surface.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/create-engine.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "./index.js";

describe("createEngine", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "createengine-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("wires a complete engine with task/loop/recovery tools", async () => {
    const engine = createEngine({ dataDir: dir, cwd: dir, client: undefined });
    await engine.init();
    const names = Object.keys(engine.tools);
    expect(names).toContain("hera_enqueue_task");
    expect(names).toContain("hera_create_loop");
    expect(names).toContain("hera_recover");
    expect(names).toContain("hera_engine_health");
    expect(typeof engine.recover).toBe("function");
    expect(typeof engine.start).toBe("function");
    expect(typeof engine.stop).toBe("function");
  });

  it("runs a task end-to-end through the factory", async () => {
    // a stub runner that writes the acceptance file: inject via the engine's executor? 
    // Instead, drive the supervisor with a custom runner by constructing through createEngine
    // is not possible (runner is internal). So enqueue a task whose acceptance is a file we create,
    // then mark it succeeded by writing the file and draining with a no-op client runner that fails ->
    // To keep this deterministic, assert the enqueue tool persists a pending task and the supervisor drains it to failed (no client => agent error).
    const engine = createEngine({ dataDir: dir, cwd: dir, client: undefined });
    await engine.init();
    const res = await (engine.tools.hera_enqueue_task as { execute: (a: unknown, c: unknown) => Promise<string> })
      .execute({ goal: "do", acceptance: [{ type: "file_exists", path: join(dir, "never.txt") }], maxAttempts: 1 }, {});
    expect(String(res)).toContain("enqueued");
    expect(engine.taskStore.byStatus("pending").length).toBe(1);
    await engine.supervisor.drain(); // no client -> agent error -> failed
    expect(engine.taskStore.byStatus("failed").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/create-engine.test.ts`
Expected: FAIL — `./index.js` / `createEngine` not found.

- [ ] **Step 3: Implement `src/engine/index.ts`**

```ts
// src/engine/index.ts
import { randomUUID } from "node:crypto";
import type { OpenCodeClient } from "../types/client.js";
import { TaskStore } from "./task-store.js";
import { LoopStore } from "./loop-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor } from "./executor.js";
import { Supervisor } from "./supervisor.js";
import { LoopManager } from "./loop-manager.js";
import { OpenCodeAgentRunner } from "./opencode-agent-runner.js";
import { createTaskTools } from "../tools/task-tools.js";
import { createLoopTools } from "../tools/loop-tools.js";
import { createRecoveryTools } from "../tools/recovery-tools.js";
import { getDefaultPermission } from "../helpers.js";
import {
  TASK_CONCURRENCY,
  TASK_LEASE_MS,
  TASK_ATTEMPT_TIMEOUT_MS,
  SUPERVISOR_TICK_MS,
  LOOP_TICK_MS,
  LOOP_DEFAULT_MAX_ITERATIONS,
  LOOP_MIN_INTERVAL_MS,
  LOOP_MAX_CONSECUTIVE_FAILURES,
} from "../constants.js";

export { TaskStore } from "./task-store.js";
export { LoopStore } from "./loop-store.js";
export { AcceptanceEvaluator } from "./acceptance.js";
export { TaskExecutor } from "./executor.js";
export { Supervisor } from "./supervisor.js";
export { LoopManager } from "./loop-manager.js";
export { OpenCodeAgentRunner } from "./opencode-agent-runner.js";
export type { AgentRunner } from "./executor.js";
export * from "./task-types.js";
export * from "./loop-types.js";

export interface EngineConfig {
  task_concurrency?: number;
  task_lease_ms?: number;
  task_attempt_timeout_ms?: number;
  loop_tick_ms?: number;
  loop_default_max_iterations?: number;
  loop_min_interval_ms?: number;
  loop_max_consecutive_failures?: number;
}

export interface EngineOptions {
  dataDir: string;
  cwd: string;
  client: OpenCodeClient | undefined;
  config?: EngineConfig;
  ownerId?: string;
  teamManager?: { recoverSessions(): Promise<number> };
}

export interface Engine {
  taskStore: TaskStore;
  loopStore: LoopStore;
  loopManager: LoopManager;
  supervisor: Supervisor;
  executor: TaskExecutor;
  evaluator: AcceptanceEvaluator;
  tools: Record<string, unknown>;
  init(): Promise<void>;
  recover(): Promise<void>;
  start(): void;
  stop(): void;
}

const NOOP_TEAM = { recoverSessions: async () => 0 };

export function createEngine(opts: EngineOptions): Engine {
  const c = opts.config ?? {};
  const taskStore = new TaskStore(opts.dataDir);
  const loopStore = new LoopStore(opts.dataDir);
  const evaluator = new AcceptanceEvaluator({
    shellEnabled: getDefaultPermission()?.bash !== "deny",
    defaultTimeoutMs: c.task_lease_ms ?? TASK_LEASE_MS,
  });
  const runner = new OpenCodeAgentRunner(opts.client, opts.cwd);
  const executor = new TaskExecutor(
    taskStore,
    evaluator,
    runner,
    opts.cwd,
    c.task_attempt_timeout_ms ?? TASK_ATTEMPT_TIMEOUT_MS
  );
  const supervisor = new Supervisor(taskStore, executor, {
    concurrency: c.task_concurrency ?? TASK_CONCURRENCY,
    leaseMs: c.task_lease_ms ?? TASK_LEASE_MS,
    tickMs: SUPERVISOR_TICK_MS,
    ownerId: opts.ownerId ?? randomUUID(),
  });
  const loopManager = new LoopManager(loopStore, taskStore, evaluator, opts.cwd, {
    tickMs: c.loop_tick_ms ?? LOOP_TICK_MS,
    defaultMaxIterations: c.loop_default_max_iterations ?? LOOP_DEFAULT_MAX_ITERATIONS,
    minIntervalMs: c.loop_min_interval_ms ?? LOOP_MIN_INTERVAL_MS,
    maxConsecutiveFailures: c.loop_max_consecutive_failures ?? LOOP_MAX_CONSECUTIVE_FAILURES,
  });

  const toolCtx = {
    taskStore,
    loopManager,
    supervisor,
    teamManager: opts.teamManager ?? NOOP_TEAM,
  } as never;
  const tools: Record<string, unknown> = {
    ...createTaskTools(toolCtx),
    ...createLoopTools(toolCtx),
    ...createRecoveryTools(toolCtx),
  };

  return {
    taskStore,
    loopStore,
    loopManager,
    supervisor,
    executor,
    evaluator,
    tools,
    async init() {
      await taskStore.init();
      await loopStore.init();
    },
    async recover() {
      await supervisor.recover();
      await loopManager.recover();
    },
    start() {
      supervisor.start();
      loopManager.start();
    },
    stop() {
      supervisor.stop();
      loopManager.stop();
    },
  };
}
```

- [ ] **Step 4: Add the package export + build entry**

In `package.json`, add to `exports` (after the `"."` entry):

```json
    "./engine": {
      "types": "./dist/engine/index.d.ts",
      "import": "./dist/engine/index.js",
      "default": "./dist/engine/index.js"
    }
```

Change the `build` script to also bundle the engine entry (insert a second `bun build` before the `tsc` step):

```
bun build src/engine/index.ts --outdir dist/engine --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk
```

So the full `build` becomes (keep the existing rm + first bun build + tsc + echo, add the engine bundle in the middle):
`node -e "...rm dist..." && bun build src/index.ts --outdir dist ... && bun build src/engine/index.ts --outdir dist/engine --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk && tsc -p tsconfig.build.json --emitDeclarationOnly --declaration --outDir dist && echo 'build done'`

- [ ] **Step 5: Run tests + build**

Run: `bun test src/engine/create-engine.test.ts` → PASS.
Run: `bun run build` → "build done"; confirm `dist/engine/index.js` exists (`ls dist/engine`).

- [ ] **Step 6: Run the broad engine + tools suites (no regression)**

Run: `bun test src/engine/ src/tools/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/index.ts src/engine/create-engine.test.ts package.json
git commit -m "feat: add createEngine factory and hera-agent/engine export"
```

---

### Task 2: `plugin-generator` engine injection (`withEngine`)

**Files:**
- Modify: `src/generators/plugin-generator.ts`
- Test: `src/generators/plugin-generator.test.ts`

**Interfaces:**
- Produces: `generate(agentDef, resolvedSkills?, opts?: { withEngine?: boolean })`; `generatePackageJson(agent, withEngine?)`; `generatePluginIndex(agent, resolvedSkills?, withEngine?)`. Default `withEngine = true`.

- [ ] **Step 1: Write the failing tests**

Append to `src/generators/plugin-generator.test.ts` (inside the existing `describe("PluginGenerator", ...)`; reuse its `generator`/`makeTestAgent` helpers):

```ts
  describe("engine injection", () => {
    it("injects createEngine wiring and the hera-agent dependency by default", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent);
      expect(Object.keys(pkg.dependencies)).toContain("hera-agent");
      const code = generator.generatePluginIndex(agent);
      expect(code).toContain('from "hera-agent/engine"');
      expect(code).toContain("createEngine(");
      expect(code).toContain("engine.start()");
      expect(code).toContain("...engine.tools");
    });

    it("omits engine wiring when withEngine is false (back-compat)", () => {
      const agent = makeTestAgent();
      const pkg = generator.generatePackageJson(agent, false);
      expect(Object.keys(pkg.dependencies)).not.toContain("hera-agent");
      const code = generator.generatePluginIndex(agent, [], false);
      expect(code).not.toContain("hera-agent/engine");
      expect(code).not.toContain("createEngine(");
    });
  });
```

(If `makeTestAgent`/`generator` are named differently in the file, match the existing names.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/generators/plugin-generator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the injection**

In `src/generators/plugin-generator.ts`:

Change `generatePackageJson(agent: AgentDefinition, withEngine = true)`; in the returned `dependencies`, conditionally add `hera-agent`:

```ts
      dependencies: {
        "@opencode-ai/plugin": "^1.4.6",
        ...(withEngine ? { "hera-agent": "^2.2.1" } : {}),
      },
```

Change `generatePluginIndex(agent, resolvedSkills = [], withEngine = true)`. When `withEngine`, add the engine import at the top of the generated `code` template, and bootstrap + tool spread inside the Plugin function. Specifically:

- Add to the generated imports (after the existing imports line):
  `import { createEngine } from "hera-agent/engine";`
  (emit this line only when `withEngine`).
- Add a `getHeraDataDir()` helper in the generated file (reuse the `getMemoryDir` pattern — the data dir is the parent of memory):
  ```
  function getHeraDataDir(): string {
    const env = process.env.HERA_DIR;
    if (env) return env;
    const home = process.env.USERPROFILE || process.env.HOME || homedir();
    return join(home, ".config", "opencode", "hera-data");
  }
  ```
- Inside the Plugin async function body, before `return {`, emit (only when `withEngine`):
  ```
  const engine = createEngine({ dataDir: getHeraDataDir(), cwd: getHeraDataDir(), client: input.client });
  await engine.init();
  await engine.recover();
  engine.start();
  ```
- In the returned `tool: { ... }` object, spread the engine tools first: emit `...engine.tools,` as the first entry (only when `withEngine`), keeping the existing `hera_remember`/`hera_recall`.

Build the generated `code` string by composing these conditional fragments. Keep the `withEngine === false` path byte-identical to the current output (so the back-compat test passes).

Update `generate(agentDef, resolvedSkills = [], opts: { withEngine?: boolean } = {})` to thread `opts.withEngine ?? true` into `generatePackageJson` and `generatePluginIndex`.

- [ ] **Step 4: Run tests**

Run: `bun test src/generators/plugin-generator.test.ts`
Expected: PASS (existing tests + 2 new; the existing `z`-alias regression test still passes for the default-withEngine output).

- [ ] **Step 5: Commit**

```bash
git add src/generators/plugin-generator.ts src/generators/plugin-generator.test.ts
git commit -m "feat: inject HDTE engine into generated agent plugins (withEngine)"
```

---

### Task 3: `team-plugin-generator` engine injection

**Files:**
- Modify: `src/generators/team-plugin-generator.ts`
- Test: `src/generators/team-plugin-generator.test.ts` (create if absent)

**Interfaces:**
- Produces: the team generator's package.json + index gain the same `withEngine` injection (default true).

- [ ] **Step 1: Read the current generator, then write the failing test**

Read `src/generators/team-plugin-generator.ts` to find its package.json + index generation methods (mirror of `PluginGenerator`). Append/create `src/generators/team-plugin-generator.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { TeamPluginGenerator } from "./team-plugin-generator.js";
// Construct a minimal TeamDefinition the generator accepts (match the file's expected shape):
const team = { name: "demo-team", description: "d", members: [{ agentName: "a", role: "dev" }], coordination: "parallel" } as never;

describe("TeamPluginGenerator engine injection", () => {
  const gen = new TeamPluginGenerator();
  it("injects createEngine wiring + hera-agent dep by default", () => {
    const pkg = gen.generatePackageJson(team);
    expect(Object.keys(pkg.dependencies)).toContain("hera-agent");
    const code = gen.generatePluginIndex(team);
    expect(code).toContain('from "hera-agent/engine"');
    expect(code).toContain("createEngine(");
    expect(code).toContain("...engine.tools");
  });
  it("omits engine wiring when withEngine is false", () => {
    const pkg = gen.generatePackageJson(team, false);
    expect(Object.keys(pkg.dependencies)).not.toContain("hera-agent");
    const code = gen.generatePluginIndex(team, false);
    expect(code).not.toContain("hera-agent/engine");
  });
});
```

(Adjust method names/signatures to match the actual `TeamPluginGenerator` API discovered when reading the file. If its index/package methods have different names, use those and keep the assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/generators/team-plugin-generator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the injection**

Apply the same `withEngine` pattern as Task 2 to `TeamPluginGenerator`: add `hera-agent` to the generated package.json dependencies; add the `createEngine` import, `getHeraDataDir()` helper, the `const engine = createEngine({...}); await engine.init(); await engine.recover(); engine.start();` bootstrap, and `...engine.tools` spread into the generated team plugin's `tool` object — all gated by a `withEngine = true` parameter, with the `false` path preserving current output.

- [ ] **Step 4: Run tests**

Run: `bun test src/generators/team-plugin-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/generators/team-plugin-generator.ts src/generators/team-plugin-generator.test.ts
git commit -m "feat: inject HDTE engine into generated team plugins (withEngine)"
```

---

### Task 4: Compaction relay (`buildActiveWorkContext`)

**Files:**
- Create: `src/engine/active-work.ts`
- Test: `src/engine/active-work.test.ts`

**Interfaces:**
- Produces: `buildActiveWorkContext(taskStore: { byStatus(s): unknown[] }, loopManager: { list(s?): Promise<unknown[]> }): Promise<string>` — empty string when no live work; otherwise a short markdown block with counts + an inspect-tool hint.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/active-work.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { LoopStore } from "./loop-store.js";
import { LoopManager } from "./loop-manager.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { buildActiveWorkContext } from "./active-work.js";

const OPTS = { tickMs: 10, defaultMaxIterations: 25, minIntervalMs: 1000, maxConsecutiveFailures: 5 };

describe("buildActiveWorkContext", () => {
  let dir: string;
  let taskStore: TaskStore;
  let loopManager: LoopManager;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "activework-"));
    taskStore = new TaskStore(dir);
    await taskStore.init();
    const loopStore = new LoopStore(dir);
    await loopStore.init();
    loopManager = new LoopManager(loopStore, taskStore, new AcceptanceEvaluator({ shellEnabled: true }), dir, OPTS, () => 1000);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns empty string when there is no live work", async () => {
    expect(await buildActiveWorkContext(taskStore, loopManager)).toBe("");
  });

  it("summarizes pending/running tasks and active loops", async () => {
    await taskStore.save({ id: "p1", goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }], status: "pending", attempts: 0, maxAttempts: 3, createdAt: 1, updatedAt: 1 });
    await loopManager.createLoop({ mode: "drain", taskTemplate: { goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }] } });
    const ctx = await buildActiveWorkContext(taskStore, loopManager);
    expect(ctx).toContain("Active durable work");
    expect(ctx).toContain("pending");
    expect(ctx).toContain("loop");
    expect(ctx).toContain("hera_engine_health");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/active-work.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/active-work.ts`**

```ts
// src/engine/active-work.ts
import type { TaskStore } from "./task-store.js";
import type { LoopManager } from "./loop-manager.js";

/**
 * Build a short context block describing live durable work, for injection into
 * a session's retained context across compaction. Returns "" when nothing is
 * live, so callers can append unconditionally.
 */
export async function buildActiveWorkContext(
  taskStore: Pick<TaskStore, "byStatus">,
  loopManager: Pick<LoopManager, "list">
): Promise<string> {
  const pending = taskStore.byStatus("pending").length;
  const running = taskStore.byStatus("running").length;
  const activeLoops = (await loopManager.list("active")).length;
  if (pending === 0 && running === 0 && activeLoops === 0) return "";
  return [
    "## Active durable work",
    `Tasks: ${pending} pending, ${running} running. Loops: ${activeLoops} active.`,
    "These persist across this compaction. Inspect with hera_task_status / hera_loop_status / hera_engine_health.",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/engine/active-work.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/active-work.ts src/engine/active-work.test.ts
git commit -m "feat: add buildActiveWorkContext for compaction relay"
```

---

### Task 5: Hera runtime refactor (`createEngine`) + compaction wiring + final gate

**Files:**
- Modify: `src/index.ts`
- Test: existing `src/index.test.ts` (regression) + add a tool-name parity assertion if practical

**Interfaces:**
- Consumes: `createEngine` (Task 1), `buildActiveWorkContext` (Task 4).

**Note:** This is an integration/refactor task — read the current `src/index.ts` carefully. Today it constructs `taskStore`, `acceptance`, `agentRunner`, `taskExecutor`, `supervisor`, `loopStore`, `loopManager` by hand and calls `recover()`/`start()`. Replace that block with `createEngine`, preserving the exact `PluginContext` fields and tool names.

- [ ] **Step 1: Refactor the engine wiring in `src/index.ts`**

Replace the hand-wired engine block with:

```ts
import { createEngine } from "./engine/index.js";
import { buildActiveWorkContext } from "./engine/active-work.js";

// where taskStore/supervisor/loopManager were constructed:
const engine = createEngine({
  dataDir: paths.dataDir,
  cwd: paths.configRoot,
  client,
  config,
  teamManager,
});
await engine.init();
await engine.recover();
engine.start();
```

Set the `PluginContext` fields from the engine: `taskStore: engine.taskStore`,
`loopManager: engine.loopManager`, `supervisor: engine.supervisor`. Keep a
module-level reference to `engine` (replacing the `_supervisor`/`_loopManager`
anchors with a single `_engine`) so the timers are not GC'd. Remove the now-dead
imports/constructions (TaskStore, AcceptanceEvaluator, OpenCodeAgentRunner,
TaskExecutor, Supervisor, LoopStore, LoopManager, and the per-construction
constants that are now only used inside `createEngine`) — but DO NOT remove
anything still referenced elsewhere in the file (check each import before
deleting). `createAllTools(ctx)` continues to build task/loop/recovery tools from
the ctx (same tool names) — do NOT also spread `engine.tools`, to avoid double
registration.

- [ ] **Step 2: Wire the compaction relay**

In the `experimental.session.compacting` hook, after the existing logic, append
the active-work context to whatever retained-context/string the hook contributes
(match the hook's current shape — if it returns or mutates a parts/context
array, append the non-empty result of
`await buildActiveWorkContext(engine.taskStore, engine.loopManager)`). If the
result is empty, append nothing. Guard with try/catch + `heraLog("warn", ...)` so
relay failure never breaks compaction.

- [ ] **Step 3: Typecheck + targeted tests**

Run: `bun run typecheck` → clean (fix any dangling references from the removed constructions).
Run: `bun test src/index.test.ts src/engine/ src/tools/` → all pass (the refactor must not change tool names or behavior).

- [ ] **Step 4: Full gate**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: typecheck clean; lint 0 errors (run `lint:fix` if CRLF errors and commit the normalization); build emits `dist/engine/index.js`; only the pre-existing flaky `install.test.ts` subprocess tests may fail.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor: wire Hera runtime via createEngine + compaction relay"
```

---

## Final verification gate

```bash
bun run typecheck && bun run lint && bun run build && bun test && npm pack --dry-run
```

`dist/engine/index.js` must exist after build. Generated-plugin runtime execution
is out of sandbox — verified statically; state this explicitly, do not claim
runtime verification.

## Self-review notes (author)

- **Coverage:** createEngine factory + `hera-agent/engine` export + build (T1);
  plugin-generator injection (T2); team-plugin-generator injection (T3);
  compaction relay (T4); Hera refactor onto createEngine + compaction wiring (T5).
- **Type consistency:** `createEngine(opts): Engine`; `Engine.tools`;
  `buildActiveWorkContext(taskStore, loopManager)`; generators' `withEngine`
  parameter default true.
- **Back-compat:** `withEngine: false` preserves current generator output;
  Hera refactor preserves tool names/behavior (gated by the existing suite).
- **Honesty:** generated-plugin runtime is statically verified only; recorded as a
  documented limitation, not a silent gap.
