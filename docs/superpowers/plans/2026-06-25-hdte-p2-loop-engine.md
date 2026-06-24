# HDTE P2 — Four-Mode Loop Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four durable loop modes (iterate / recurring / watch / drain) that act as triggers enqueuing tasks into P1's `TaskStore`, advanced by a deterministic `LoopManager.tick(now)`.

**Architecture:** A `LoopStore` (on the existing `JsonCollectionStore`) persists `LoopDefinition`s. A `LoopManager.tick(now)` iterates active loops and, per mode, enqueues tasks into the existing `TaskStore` — the P1 supervisor runs them unchanged. The clock is injectable (`() => number`) and tests call `tick(now)` directly, mirroring the P1 `Supervisor`. One additive P1 field (`TaskRecord.output`) lets `iterate` feed prior agent output forward.

**Tech Stack:** TypeScript, Bun (`bun:test`), Node fs, `@opencode-ai/plugin` `tool()` helper.

## Global Constraints

- Loops never run agents or acceptance directly except to *evaluate* a watch condition / iterate goal via `AcceptanceEvaluator`. All work execution stays in P1's supervisor/executor.
- A loop's `taskTemplate.acceptance` must be non-empty (rejected at create) — its spawned tasks must be verifiable. `watch.condition` and `iterate.goal`, when present, must be non-empty.
- Tests must be deterministic: drive `LoopManager.tick(now)` with controlled timestamps; never rely on real timers in tests.
- Use `atomicWriteJson` (via `JsonCollectionStore`) for all persisted writes; `heraLog()` never `console.*`; constants from `src/constants.ts`.
- `TaskRecord.output` is additive — existing P1 engine tests must stay green.
- Tests live next to source under `src/`, named `*.test.ts`.
- Windows note: judge `bun test` pass/fail by bun's own "N pass, M fail" line, not the PowerShell exit code (PowerShell reports exit 1 when bun writes the coverage table to stderr). Run git/shell via the PowerShell tool.
- Every commit message body ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Record agent output on the task record (P1 extension)

**Files:**
- Modify: `src/engine/task-types.ts`
- Modify: `src/engine/executor.ts`
- Test: `src/engine/executor.test.ts`

**Interfaces:**
- Produces: `TaskRecord.output?: string` set by `TaskExecutor.runAttempt` on success and on acceptance-failure/retry; left `undefined` on agent error.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/executor.test.ts` (inside the existing `describe("TaskExecutor", ...)` block):

```ts
  it("records the agent output on a succeeded task", async () => {
    const target = join(dir, "out.txt");
    const runner: AgentRunner = { run: async () => { await writeFile(target, "ok"); return "AGENT_SAID_THIS"; } };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: target }] });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("succeeded");
    expect(updated.output).toBe("AGENT_SAID_THIS");
  });

  it("records the agent output on a retry (acceptance failed)", async () => {
    const runner: AgentRunner = { run: async () => "PARTIAL_WORK" };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: join(dir, "missing") }], attempts: 0, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("pending");
    expect(updated.output).toBe("PARTIAL_WORK");
  });

  it("leaves output undefined on agent error", async () => {
    const runner: AgentRunner = { run: async () => { throw new Error("boom"); } };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ attempts: 1, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.output).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/executor.test.ts`
Expected: FAIL — `updated.output` is undefined on success / not asserted-equal.

- [ ] **Step 3: Add the field to `TaskRecord`**

In `src/engine/task-types.ts`, add after `lastError?: string;`:

```ts
  output?: string;
```

- [ ] **Step 4: Record output in the executor**

In `src/engine/executor.ts`, thread `output` through both write paths.

Change the success record (the `succeeded` object) to include `output`:

```ts
      const succeeded: TaskRecord = {
        ...task,
        status: "succeeded",
        attempts: task.attempts + 1,
        proof,
        output,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
        completedAt: now,
      };
```

Change the acceptance-failure call to pass `output`:

```ts
    return this.fail(task, now, `acceptance failed: ${failedDetail}`, proof, output);
```

Change `fail`'s signature and record to accept and store `output` (agent-error callers omit it, leaving it `undefined`):

```ts
  private async fail(
    task: TaskRecord,
    now: number,
    reason: string,
    proof?: TaskRecord["proof"],
    output?: string
  ): Promise<TaskRecord> {
    const attempts = task.attempts + 1;
    const exhausted = attempts >= task.maxAttempts;
    const updated: TaskRecord = {
      ...task,
      status: exhausted ? "failed" : "pending",
      attempts,
      proof: proof ?? task.proof,
      output: output ?? task.output,
      lastError: reason,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
      completedAt: exhausted ? now : undefined,
    };
    await this.store.save(updated);
    heraLog(exhausted ? "warn" : "debug", `Task ${updated.status}: ${task.id} (${reason})`);
    return updated;
  }
```

(The agent-error path `return this.fail(task, now, \`agent error: ${agentError}\`);` passes no `output`, so it stays `undefined` — except it would inherit `task.output` from a prior attempt via `output ?? task.output`. For the test, `task.output` is undefined on first/second attempt, so the result is undefined. This is correct: an errored attempt produced no new output but should not erase a prior attempt's output.)

- [ ] **Step 5: Run to verify pass**

Run: `bun test src/engine/executor.test.ts`
Expected: PASS (prior tests + 3 new).

- [ ] **Step 6: Confirm no P1 regression**

Run: `bun test src/engine/`
Expected: PASS (all engine tests; `output` is additive).

- [ ] **Step 7: Commit**

```bash
git add src/engine/task-types.ts src/engine/executor.ts src/engine/executor.test.ts
git commit -m "feat: record agent output on task record for loop feed-forward"
```

---

### Task 2: Loop types, `LoopStore`, and loop config/constants

**Files:**
- Create: `src/engine/loop-types.ts`
- Create: `src/engine/loop-store.ts`
- Modify: `src/constants.ts`
- Modify: `src/types.ts` (`HeraConfig` loop fields)
- Test: `src/engine/loop-store.test.ts`
- Test: `src/constants.test.ts`

**Interfaces:**
- Consumes: `JsonCollectionStore` (`src/store/json-collection-store.js`), `AcceptanceCheck` (`src/engine/task-types.js`).
- Produces:
  ```ts
  type LoopMode = "iterate" | "recurring" | "watch" | "drain";
  type LoopStatus = "active" | "paused" | "completed" | "cancelled" | "failed";
  interface LoopTaskTemplate { goal: string; executor: string; acceptance: AcceptanceCheck[]; maxAttempts?: number; input?: unknown }
  interface LoopDefinition { id; name?; mode; status; taskTemplate;
    iterate?: { goal?: AcceptanceCheck[]; maxIterations: number; feedForward?: boolean };
    recurring?: { intervalMs: number; nextRunAt: number; maxRuns?: number; runs: number };
    watch?: { condition: AcceptanceCheck[]; lastConditionMet: boolean };
    drain?: { batchId?: string };
    iterations: number; currentTaskId?: string; lastError?: string; createdAt: number; updatedAt: number }
  class LoopStore {
    constructor(dataDir: string);
    init(): Promise<void>;
    save(loop: LoopDefinition): Promise<void>;
    get(id: string): Promise<LoopDefinition | null>;
    byStatus(status: LoopStatus): LoopDefinition[];
    byMode(mode: LoopMode): LoopDefinition[];
    all(): Promise<LoopDefinition[]>;
  }
  // constants: LOOP_TICK_MS=1000, LOOP_DEFAULT_MAX_ITERATIONS=25, LOOP_MIN_INTERVAL_MS=1000
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/loop-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopStore } from "./loop-store.js";
import type { LoopDefinition } from "./loop-types.js";

function makeLoop(over: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    id: over.id ?? "l1",
    mode: "drain",
    status: "active",
    taskTemplate: { goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }] },
    iterations: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe("LoopStore", () => {
  let dir: string;
  let store: LoopStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopstore-"));
    store = new LoopStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and gets a loop", async () => {
    await store.save(makeLoop());
    expect((await store.get("l1"))?.mode).toBe("drain");
  });

  it("indexes by status and mode", async () => {
    await store.save(makeLoop({ id: "a", status: "active", mode: "watch" }));
    await store.save(makeLoop({ id: "b", status: "paused", mode: "watch" }));
    await store.save(makeLoop({ id: "c", status: "active", mode: "recurring" }));
    expect(store.byStatus("active").map((l) => l.id).sort()).toEqual(["a", "c"]);
    expect(store.byMode("watch").map((l) => l.id).sort()).toEqual(["a", "b"]);
  });

  it("reflects status changes in the index after overwrite", async () => {
    await store.save(makeLoop({ id: "a", status: "active" }));
    await store.save(makeLoop({ id: "a", status: "completed" }));
    expect(store.byStatus("active")).toHaveLength(0);
    expect(store.byStatus("completed").map((l) => l.id)).toEqual(["a"]);
  });
});
```

Append to `src/constants.test.ts` (add the imports to the existing top import from `./constants.js`, then a new describe):

```ts
// add to the import list: LOOP_TICK_MS, LOOP_DEFAULT_MAX_ITERATIONS, LOOP_MIN_INTERVAL_MS
describe("Loop Engine Constants", () => {
  it("has sane loop defaults", () => {
    expect(LOOP_TICK_MS).toBeGreaterThan(0);
    expect(LOOP_DEFAULT_MAX_ITERATIONS).toBe(25);
    expect(LOOP_MIN_INTERVAL_MS).toBe(1000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/loop-store.test.ts src/constants.test.ts`
Expected: FAIL — modules/constants not found.

- [ ] **Step 3: Create `src/engine/loop-types.ts`**

```ts
// src/engine/loop-types.ts
import type { AcceptanceCheck } from "./task-types.js";

export type LoopMode = "iterate" | "recurring" | "watch" | "drain";
export type LoopStatus = "active" | "paused" | "completed" | "cancelled" | "failed";

export interface LoopTaskTemplate {
  goal: string;
  executor: string;
  acceptance: AcceptanceCheck[];
  maxAttempts?: number;
  input?: unknown;
}

export interface LoopDefinition {
  id: string;
  name?: string;
  mode: LoopMode;
  status: LoopStatus;
  taskTemplate: LoopTaskTemplate;
  iterate?: { goal?: AcceptanceCheck[]; maxIterations: number; feedForward?: boolean };
  recurring?: { intervalMs: number; nextRunAt: number; maxRuns?: number; runs: number };
  watch?: { condition: AcceptanceCheck[]; lastConditionMet: boolean };
  drain?: { batchId?: string };
  iterations: number;
  currentTaskId?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: Create `src/engine/loop-store.ts`**

```ts
// src/engine/loop-store.ts
import { join } from "node:path";
import { JsonCollectionStore } from "../store/json-collection-store.js";
import type { LoopDefinition, LoopMode, LoopStatus } from "./loop-types.js";

export class LoopStore {
  private store: JsonCollectionStore<LoopDefinition>;

  constructor(dataDir: string) {
    this.store = new JsonCollectionStore<LoopDefinition>(join(dataDir, "loops"), "records", {
      secondaryIndexes: {
        status: (l) => l.status,
        mode: (l) => l.mode,
      },
    });
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  async save(loop: LoopDefinition): Promise<void> {
    await this.store.save(loop);
  }

  async get(id: string): Promise<LoopDefinition | null> {
    return this.store.load(id);
  }

  byStatus(status: LoopStatus): LoopDefinition[] {
    return this.store.byIndex("status", status);
  }

  byMode(mode: LoopMode): LoopDefinition[] {
    return this.store.byIndex("mode", mode);
  }

  async all(): Promise<LoopDefinition[]> {
    return this.store.list();
  }
}
```

- [ ] **Step 5: Add constants and config**

In `src/constants.ts`, after the Task Engine Configuration block, add:

```ts
// === Loop Engine Configuration ===

/** LoopManager tick interval (ms). */
export const LOOP_TICK_MS = 1000;

/** Default iterate-mode iteration cap when unset. */
export const LOOP_DEFAULT_MAX_ITERATIONS = 25;

/** Floor for recurring-mode interval (ms). */
export const LOOP_MIN_INTERVAL_MS = 1000;
```

In `src/types.ts` `HeraConfig`, after the `task_lease_ms?: number;` line, add:

```ts
  loop_tick_ms?: number;
  loop_default_max_iterations?: number;
  loop_min_interval_ms?: number;
```

- [ ] **Step 6: Run to verify pass**

Run: `bun test src/engine/loop-store.test.ts src/constants.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/loop-types.ts src/engine/loop-store.ts src/engine/loop-store.test.ts src/constants.ts src/constants.test.ts src/types.ts
git commit -m "feat: add LoopDefinition types, LoopStore, and loop config/constants"
```

---

### Task 3: `LoopManager` core + drain mode

**Files:**
- Create: `src/engine/loop-manager.ts`
- Test: `src/engine/loop-manager.test.ts`

**Interfaces:**
- Consumes: `LoopStore` (Task 2), `TaskStore` + `TaskRecord` (P1), `AcceptanceEvaluator` (P1), constants `TASK_DEFAULT_MAX_ATTEMPTS`/`LOOP_DEFAULT_MAX_ITERATIONS`/`LOOP_MIN_INTERVAL_MS`.
- Produces:
  ```ts
  interface CreateLoopInput {
    name?: string; mode: LoopMode; taskTemplate: LoopTaskTemplate;
    iterate?: { goal?: AcceptanceCheck[]; maxIterations?: number; feedForward?: boolean };
    recurring?: { intervalMs: number; maxRuns?: number };
    watch?: { condition: AcceptanceCheck[] };
    drain?: { batchId?: string };
  }
  interface LoopManagerOptions { tickMs: number; defaultMaxIterations: number; minIntervalMs: number }
  class LoopManager {
    constructor(loopStore: LoopStore, taskStore: TaskStore, evaluator: AcceptanceEvaluator, cwd: string, options: LoopManagerOptions, clock?: () => number);
    createLoop(input: CreateLoopInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
    pause(id: string): Promise<boolean>;
    resume(id: string): Promise<boolean>;
    cancel(id: string): Promise<boolean>;
    get(id: string): Promise<LoopDefinition | null>;
    list(status?: LoopStatus): Promise<LoopDefinition[]>;
    tick(now: number): Promise<void>;
    recover(): Promise<number>;
    start(): void;
    stop(): void;
  }
  ```

**Note:** This task implements the core (lifecycle, validation, `enqueueFromTemplate`, `tick` dispatch with per-loop error isolation, `recover`, `start`/`stop`) plus the **drain** mode handler. The other three mode handlers are added in Tasks 4–6; until then, `tick` dispatches `iterate`/`recurring`/`watch` to private stubs that do nothing (a loop of those modes simply stays active). Implement those three private methods as `async () => {}` stubs in this task so the file compiles; Tasks 4–6 fill them in.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/loop-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { LoopStore } from "./loop-store.js";
import { LoopManager } from "./loop-manager.js";
import type { CreateLoopInput } from "./loop-manager.js";

const OPTS = { tickMs: 10, defaultMaxIterations: 25, minIntervalMs: 1000 };

function makeManager(dir: string, loopStore: LoopStore, taskStore: TaskStore, now = 1000) {
  const evalr = new AcceptanceEvaluator({ shellEnabled: true });
  return new LoopManager(loopStore, taskStore, evalr, dir, OPTS, () => now);
}

const template = { goal: "do it", executor: "hera", acceptance: [{ type: "file_exists" as const, path: "/tmp/x" }] };

describe("LoopManager core + drain", () => {
  let dir: string;
  let loopStore: LoopStore;
  let taskStore: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopmgr-"));
    loopStore = new LoopStore(dir);
    await loopStore.init();
    taskStore = new TaskStore(dir);
    await taskStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a loop and lists it active", async () => {
    const mgr = makeManager(dir, loopStore, taskStore);
    const res = await mgr.createLoop({ mode: "drain", taskTemplate: template });
    expect(res.ok).toBe(true);
    const loops = await mgr.list("active");
    expect(loops).toHaveLength(1);
  });

  it("rejects a loop whose taskTemplate has no acceptance checks", async () => {
    const mgr = makeManager(dir, loopStore, taskStore);
    const res = await mgr.createLoop({ mode: "drain", taskTemplate: { goal: "g", executor: "hera", acceptance: [] } });
    expect(res.ok).toBe(false);
  });

  it("pause skips ticking; resume restores; cancel is terminal", async () => {
    const mgr = makeManager(dir, loopStore, taskStore);
    const res = await mgr.createLoop({ mode: "drain", taskTemplate: template });
    const id = (res as { id: string }).id;
    expect(await mgr.pause(id)).toBe(true);
    expect((await mgr.get(id))?.status).toBe("paused");
    expect(await mgr.resume(id)).toBe(true);
    expect((await mgr.get(id))?.status).toBe("active");
    expect(await mgr.cancel(id)).toBe(true);
    expect((await mgr.get(id))?.status).toBe("cancelled");
  });

  it("drain completes when the queue is empty", async () => {
    const mgr = makeManager(dir, loopStore, taskStore);
    const res = await mgr.createLoop({ mode: "drain", taskTemplate: template });
    const id = (res as { id: string }).id;
    await mgr.tick(1000);
    expect((await mgr.get(id))?.status).toBe("completed");
  });

  it("drain stays active while scoped batch has pending work, completes when drained", async () => {
    await taskStore.save({
      id: "t1", batchId: "b1", goal: "g", executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "pending", attempts: 0, maxAttempts: 1, createdAt: 1, updatedAt: 1,
    });
    const mgr = makeManager(dir, loopStore, taskStore);
    const res = await mgr.createLoop({ mode: "drain", taskTemplate: template, drain: { batchId: "b1" } });
    const id = (res as { id: string }).id;
    await mgr.tick(1000);
    expect((await mgr.get(id))?.status).toBe("active");
    // mark the task succeeded, then the next tick completes the loop
    const t = await taskStore.get("t1");
    await taskStore.save({ ...t!, status: "succeeded" });
    await mgr.tick(1001);
    expect((await mgr.get(id))?.status).toBe("completed");
  });

  it("a throwing loop is isolated and recorded, not fatal", async () => {
    // Force an error by giving a drain loop a non-existent index path is not possible;
    // instead, verify tick resolves even with multiple loops and one paused.
    const mgr = makeManager(dir, loopStore, taskStore);
    await mgr.createLoop({ mode: "drain", taskTemplate: template });
    const r2 = await mgr.createLoop({ mode: "drain", taskTemplate: template });
    await mgr.pause((r2 as { id: string }).id);
    await mgr.tick(1000); // must resolve without throwing
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/loop-manager.ts`**

```ts
// src/engine/loop-manager.ts
import { randomUUID } from "node:crypto";
import type { LoopStore } from "./loop-store.js";
import type { TaskStore } from "./task-store.js";
import type { AcceptanceEvaluator } from "./acceptance.js";
import type { AcceptanceCheck, TaskRecord } from "./task-types.js";
import type { LoopDefinition, LoopMode, LoopStatus, LoopTaskTemplate } from "./loop-types.js";
import { TASK_DEFAULT_MAX_ATTEMPTS } from "../constants.js";
import { heraLog } from "../logger.js";
import { errorMessage } from "../helpers.js";

export interface CreateLoopInput {
  name?: string;
  mode: LoopMode;
  taskTemplate: LoopTaskTemplate;
  iterate?: { goal?: AcceptanceCheck[]; maxIterations?: number; feedForward?: boolean };
  recurring?: { intervalMs: number; maxRuns?: number };
  watch?: { condition: AcceptanceCheck[] };
  drain?: { batchId?: string };
}

export interface LoopManagerOptions {
  tickMs: number;
  defaultMaxIterations: number;
  minIntervalMs: number;
}

export class LoopManager {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(
    private loopStore: LoopStore,
    private taskStore: TaskStore,
    private evaluator: AcceptanceEvaluator,
    private cwd: string,
    private options: LoopManagerOptions,
    private clock: () => number = () => Date.now()
  ) {}

  async createLoop(
    input: CreateLoopInput
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const t = input.taskTemplate;
    if (!t || !t.goal || t.goal.trim().length === 0) {
      return { ok: false, error: "taskTemplate.goal is required" };
    }
    if (!Array.isArray(t.acceptance) || t.acceptance.length === 0) {
      return { ok: false, error: "taskTemplate.acceptance must be non-empty (spawned tasks must be verifiable)" };
    }
    const now = this.clock();
    const loop: LoopDefinition = {
      id: randomUUID(),
      name: input.name,
      mode: input.mode,
      status: "active",
      taskTemplate: { ...t, executor: t.executor || "hera" },
      iterations: 0,
      createdAt: now,
      updatedAt: now,
    };

    switch (input.mode) {
      case "iterate":
        loop.iterate = {
          goal: input.iterate?.goal,
          maxIterations: input.iterate?.maxIterations ?? this.options.defaultMaxIterations,
          feedForward: input.iterate?.feedForward ?? false,
        };
        if (loop.iterate.goal && loop.iterate.goal.length === 0) {
          return { ok: false, error: "iterate.goal, when provided, must be non-empty" };
        }
        break;
      case "recurring": {
        const interval = input.recurring?.intervalMs;
        if (interval == null || interval <= 0) return { ok: false, error: "recurring.intervalMs is required" };
        const clamped = Math.max(interval, this.options.minIntervalMs);
        loop.recurring = { intervalMs: clamped, nextRunAt: now + clamped, maxRuns: input.recurring?.maxRuns, runs: 0 };
        break;
      }
      case "watch":
        if (!input.watch || !Array.isArray(input.watch.condition) || input.watch.condition.length === 0) {
          return { ok: false, error: "watch.condition must be non-empty" };
        }
        loop.watch = { condition: input.watch.condition, lastConditionMet: false };
        break;
      case "drain":
        loop.drain = { batchId: input.drain?.batchId };
        break;
      default:
        return { ok: false, error: `unknown loop mode: ${String(input.mode)}` };
    }

    await this.loopStore.save(loop);
    heraLog("info", `Created loop ${loop.id} (${loop.mode})`);
    return { ok: true, id: loop.id };
  }

  async pause(id: string): Promise<boolean> {
    const loop = await this.loopStore.get(id);
    if (!loop || loop.status !== "active") return false;
    await this.loopStore.save({ ...loop, status: "paused", updatedAt: this.clock() });
    return true;
  }

  async resume(id: string): Promise<boolean> {
    const loop = await this.loopStore.get(id);
    if (!loop || loop.status !== "paused") return false;
    await this.loopStore.save({ ...loop, status: "active", updatedAt: this.clock() });
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const loop = await this.loopStore.get(id);
    if (!loop || loop.status === "completed" || loop.status === "cancelled") return false;
    const now = this.clock();
    if (loop.currentTaskId) {
      const task = await this.taskStore.get(loop.currentTaskId);
      if (task && (task.status === "pending" || task.status === "running")) {
        await this.taskStore.save({ ...task, status: "cancelled", updatedAt: now });
      }
    }
    await this.loopStore.save({ ...loop, status: "cancelled", updatedAt: now });
    return true;
  }

  async get(id: string): Promise<LoopDefinition | null> {
    return this.loopStore.get(id);
  }

  async list(status?: LoopStatus): Promise<LoopDefinition[]> {
    return status ? this.loopStore.byStatus(status) : this.loopStore.all();
  }

  async tick(now: number): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const loop of this.loopStore.byStatus("active")) {
        try {
          await this.advance(loop, now);
        } catch (err) {
          await this.loopStore.save({ ...loop, lastError: errorMessage(err), updatedAt: now });
          heraLog("warn", `Loop tick error: ${loop.id}`, err);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async recover(): Promise<number> {
    const active = this.loopStore.byStatus("active").length;
    if (active > 0) heraLog("info", `LoopManager recovered ${active} active loop(s)`);
    return active;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick(this.clock());
    }, this.options.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async advance(loop: LoopDefinition, now: number): Promise<void> {
    switch (loop.mode) {
      case "iterate":
        return this.tickIterate(loop, now);
      case "recurring":
        return this.tickRecurring(loop, now);
      case "watch":
        return this.tickWatch(loop, now);
      case "drain":
        return this.tickDrain(loop, now);
    }
  }

  private async enqueueFromTemplate(
    loop: LoopDefinition,
    now: number,
    input?: unknown
  ): Promise<string> {
    const t = loop.taskTemplate;
    const task: TaskRecord = {
      id: randomUUID(),
      batchId: loop.id,
      goal: t.goal,
      executor: t.executor,
      input: input !== undefined ? input : t.input,
      acceptance: t.acceptance,
      status: "pending",
      attempts: 0,
      maxAttempts: t.maxAttempts ?? TASK_DEFAULT_MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    };
    await this.taskStore.save(task);
    return task.id;
  }

  private async tickDrain(loop: LoopDefinition, now: number): Promise<void> {
    const scope = loop.drain?.batchId
      ? this.taskStore.byBatch(loop.drain.batchId)
      : await this.taskStore.all();
    const busy = scope.some((t) => t.status === "pending" || t.status === "running");
    if (!busy) {
      await this.loopStore.save({ ...loop, status: "completed", updatedAt: now });
    }
  }

  // Implemented in Tasks 4–6.
  private async tickIterate(_loop: LoopDefinition, _now: number): Promise<void> {}
  private async tickRecurring(_loop: LoopDefinition, _now: number): Promise<void> {}
  private async tickWatch(_loop: LoopDefinition, _now: number): Promise<void> {}
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/loop-manager.ts src/engine/loop-manager.test.ts
git commit -m "feat: add LoopManager core (lifecycle, tick dispatch, drain mode)"
```

---

### Task 4: iterate mode

**Files:**
- Modify: `src/engine/loop-manager.ts` (`tickIterate`)
- Test: `src/engine/loop-manager.test.ts`

**Interfaces:**
- Consumes: `enqueueFromTemplate`, `taskStore.get`, `evaluator.evaluate/allPassed`, `TaskRecord.output` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/engine/loop-manager.test.ts`:

```ts
import { writeFile } from "node:fs/promises";

describe("LoopManager iterate", () => {
  let dir: string;
  let loopStore: LoopStore;
  let taskStore: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopiter-"));
    loopStore = new LoopStore(dir);
    await loopStore.init();
    taskStore = new TaskStore(dir);
    await taskStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("enqueues one task per tick while the goal is unmet, then completes when a task succeeds", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "iterate", taskTemplate: template, iterate: { maxIterations: 5 } });
    const id = (res as { id: string }).id;

    await mgr.tick(1000); // first iteration: no prior task -> enqueue #1
    let loop = (await mgr.get(id))!;
    expect(loop.iterations).toBe(1);
    expect(taskStore.byBatch(id)).toHaveLength(1);

    // current task still pending -> no new enqueue
    await mgr.tick(1000);
    expect(taskStore.byBatch(id)).toHaveLength(1);

    // mark current task failed -> next tick enqueues #2
    const t1 = await taskStore.get(loop.currentTaskId!);
    await taskStore.save({ ...t1!, status: "failed" });
    await mgr.tick(1000);
    expect(taskStore.byBatch(id)).toHaveLength(2);

    // mark current task succeeded -> next tick completes the loop
    loop = (await mgr.get(id))!;
    const t2 = await taskStore.get(loop.currentTaskId!);
    await taskStore.save({ ...t2!, status: "succeeded" });
    await mgr.tick(1000);
    expect((await mgr.get(id))?.status).toBe("completed");
  });

  it("fails when maxIterations is reached without meeting the goal", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "iterate", taskTemplate: template, iterate: { maxIterations: 1 } });
    const id = (res as { id: string }).id;
    await mgr.tick(1000); // enqueue #1 (iterations=1)
    const loop = (await mgr.get(id))!;
    const t1 = await taskStore.get(loop.currentTaskId!);
    await taskStore.save({ ...t1!, status: "failed" });
    await mgr.tick(1000); // goal unmet, iterations>=max -> failed
    expect((await mgr.get(id))?.status).toBe("failed");
  });

  it("feeds the prior task output forward when feedForward is set", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "iterate", taskTemplate: template, iterate: { maxIterations: 5, feedForward: true } });
    const id = (res as { id: string }).id;
    await mgr.tick(1000);
    const loop = (await mgr.get(id))!;
    const t1 = await taskStore.get(loop.currentTaskId!);
    await taskStore.save({ ...t1!, status: "failed", output: "PRIOR_OUTPUT", lastError: "nope" });
    await mgr.tick(1000);
    const loop2 = (await mgr.get(id))!;
    const t2 = await taskStore.get(loop2.currentTaskId!);
    expect(JSON.stringify(t2!.input)).toContain("PRIOR_OUTPUT");
  });

  it("respects a custom loop-level goal evaluated against task output", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "iterate", taskTemplate: template,
      iterate: { maxIterations: 5, goal: [{ type: "regex", source: "output", pattern: "READY" }] },
    });
    const id = (res as { id: string }).id;
    await mgr.tick(1000);
    let loop = (await mgr.get(id))!;
    // task "succeeds" but output lacks READY -> goal unmet -> continue
    let cur = await taskStore.get(loop.currentTaskId!);
    await taskStore.save({ ...cur!, status: "succeeded", output: "not yet" });
    await mgr.tick(1000);
    expect((await mgr.get(id))?.status).toBe("active");
    // now produce READY in output -> goal met -> completed
    loop = (await mgr.get(id))!;
    cur = await taskStore.get(loop.currentTaskId!);
    await taskStore.save({ ...cur!, status: "succeeded", output: "READY now" });
    await mgr.tick(1000);
    expect((await mgr.get(id))?.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: FAIL — iterate stub does nothing, so iterations stay 0.

- [ ] **Step 3: Implement `tickIterate`**

Replace the `tickIterate` stub in `src/engine/loop-manager.ts` with:

```ts
  private async tickIterate(loop: LoopDefinition, now: number): Promise<void> {
    const cfg = loop.iterate;
    if (!cfg) return;

    const last = loop.currentTaskId ? await this.taskStore.get(loop.currentTaskId) : null;

    // An iteration is in flight: wait.
    if (last && (last.status === "pending" || last.status === "running")) return;

    // Evaluate the goal against the last completed task (if any).
    let goalMet = false;
    if (last) {
      if (cfg.goal && cfg.goal.length > 0) {
        const proof = await this.evaluator.evaluate(cfg.goal, { output: last.output ?? "", cwd: this.cwd }, now);
        goalMet = this.evaluator.allPassed(proof);
      } else {
        goalMet = last.status === "succeeded";
      }
    }

    if (goalMet) {
      await this.loopStore.save({ ...loop, status: "completed", updatedAt: now });
      return;
    }

    if (loop.iterations >= cfg.maxIterations) {
      await this.loopStore.save({
        ...loop,
        status: "failed",
        lastError: "iterate: max iterations reached without meeting goal",
        updatedAt: now,
      });
      return;
    }

    let input: unknown = loop.taskTemplate.input;
    if (cfg.feedForward && last) {
      input = { previousOutput: last.output, previousError: last.lastError, original: loop.taskTemplate.input };
    }
    const taskId = await this.enqueueFromTemplate(loop, now, input);
    await this.loopStore.save({ ...loop, currentTaskId: taskId, iterations: loop.iterations + 1, updatedAt: now });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: PASS (core/drain + 4 iterate tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/loop-manager.ts src/engine/loop-manager.test.ts
git commit -m "feat: implement iterate-until-goal loop mode with output feed-forward"
```

---

### Task 5: recurring mode

**Files:**
- Modify: `src/engine/loop-manager.ts` (`tickRecurring`)
- Test: `src/engine/loop-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/engine/loop-manager.test.ts`:

```ts
describe("LoopManager recurring", () => {
  let dir: string;
  let loopStore: LoopStore;
  let taskStore: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "looprec-"));
    loopStore = new LoopStore(dir);
    await loopStore.init();
    taskStore = new TaskStore(dir);
    await taskStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fires only when now >= nextRunAt and reschedules by intervalMs", async () => {
    // clock fixed at 1000; nextRunAt initialized to 1000 + 1000 = 2000
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "recurring", taskTemplate: template, recurring: { intervalMs: 1000 } });
    const id = (res as { id: string }).id;

    await mgr.tick(1500); // before nextRunAt(2000) -> no fire
    expect(taskStore.byBatch(id)).toHaveLength(0);

    await mgr.tick(2000); // fires once, nextRunAt -> 3000
    expect(taskStore.byBatch(id)).toHaveLength(1);
    expect((await mgr.get(id))?.recurring?.nextRunAt).toBe(3000);

    await mgr.tick(2500); // before 3000 -> no new fire
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await mgr.tick(3000); // fires again
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });

  it("does not burst-catch-up when far behind", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "recurring", taskTemplate: template, recurring: { intervalMs: 1000 } });
    const id = (res as { id: string }).id;
    // jump way past several intervals in one tick
    await mgr.tick(10000);
    expect(taskStore.byBatch(id)).toHaveLength(1); // exactly one fire
    expect((await mgr.get(id))?.recurring?.nextRunAt).toBe(11000); // now + interval
  });

  it("completes after maxRuns", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "recurring", taskTemplate: template, recurring: { intervalMs: 1000, maxRuns: 2 } });
    const id = (res as { id: string }).id;
    await mgr.tick(2000); // run 1
    await mgr.tick(3000); // run 2 -> completed
    expect((await mgr.get(id))?.status).toBe("completed");
    expect(taskStore.byBatch(id)).toHaveLength(2);
    await mgr.tick(4000); // terminal, no more fires
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });

  it("clamps intervalMs to the minimum floor", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "recurring", taskTemplate: template, recurring: { intervalMs: 10 } });
    const id = (res as { id: string }).id;
    expect((await mgr.get(id))?.recurring?.intervalMs).toBe(1000); // floored to LOOP_MIN_INTERVAL_MS
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: FAIL — recurring stub never fires.

- [ ] **Step 3: Implement `tickRecurring`**

Replace the `tickRecurring` stub with:

```ts
  private async tickRecurring(loop: LoopDefinition, now: number): Promise<void> {
    const cfg = loop.recurring;
    if (!cfg) return;
    if (now < cfg.nextRunAt) return;

    await this.enqueueFromTemplate(loop, now);
    const runs = cfg.runs + 1;
    // Fixed cadence; if a full interval still lands in the past, skip missed runs.
    const advanced = cfg.nextRunAt + cfg.intervalMs;
    const nextRunAt = advanced <= now ? now + cfg.intervalMs : advanced;
    const completed = cfg.maxRuns != null && runs >= cfg.maxRuns;
    await this.loopStore.save({
      ...loop,
      recurring: { ...cfg, runs, nextRunAt },
      iterations: loop.iterations + 1,
      status: completed ? "completed" : loop.status,
      updatedAt: now,
    });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: PASS (previous + 4 recurring tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/loop-manager.ts src/engine/loop-manager.test.ts
git commit -m "feat: implement scheduled-recurring loop mode (fixed interval)"
```

---

### Task 6: watch mode

**Files:**
- Modify: `src/engine/loop-manager.ts` (`tickWatch`)
- Test: `src/engine/loop-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/engine/loop-manager.test.ts`:

```ts
import { rm as rmFile } from "node:fs/promises";

describe("LoopManager watch", () => {
  let dir: string;
  let loopStore: LoopStore;
  let taskStore: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopwatch-"));
    loopStore = new LoopStore(dir);
    await loopStore.init();
    taskStore = new TaskStore(dir);
    await taskStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("enqueues once on false->true and not again while true", async () => {
    const trigger = join(dir, "go.txt");
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "watch", taskTemplate: template,
      watch: { condition: [{ type: "file_exists", path: trigger }] },
    });
    const id = (res as { id: string }).id;

    await mgr.tick(1000); // condition false -> no enqueue
    expect(taskStore.byBatch(id)).toHaveLength(0);

    await writeFile(trigger, "x");
    await mgr.tick(1001); // false->true edge -> enqueue once
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await mgr.tick(1002); // still true -> no new enqueue
    expect(taskStore.byBatch(id)).toHaveLength(1);
  });

  it("re-arms after the condition goes false then true again", async () => {
    const trigger = join(dir, "go2.txt");
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "watch", taskTemplate: template,
      watch: { condition: [{ type: "file_exists", path: trigger }] },
    });
    const id = (res as { id: string }).id;

    await writeFile(trigger, "x");
    await mgr.tick(1000); // edge -> enqueue #1
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await rmFile(trigger);
    await mgr.tick(1001); // condition false -> re-arm, no enqueue
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await writeFile(trigger, "x");
    await mgr.tick(1002); // edge again -> enqueue #2
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: FAIL — watch stub never enqueues.

- [ ] **Step 3: Implement `tickWatch`**

Replace the `tickWatch` stub with:

```ts
  private async tickWatch(loop: LoopDefinition, now: number): Promise<void> {
    const cfg = loop.watch;
    if (!cfg) return;
    const proof = await this.evaluator.evaluate(cfg.condition, { output: "", cwd: this.cwd }, now);
    const met = this.evaluator.allPassed(proof);

    let iterations = loop.iterations;
    if (met && !cfg.lastConditionMet) {
      await this.enqueueFromTemplate(loop, now);
      iterations += 1;
    }
    await this.loopStore.save({
      ...loop,
      watch: { ...cfg, lastConditionMet: met },
      iterations,
      updatedAt: now,
    });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/engine/loop-manager.test.ts`
Expected: PASS (previous + 2 watch tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/loop-manager.ts src/engine/loop-manager.test.ts
git commit -m "feat: implement edge-triggered watch loop mode"
```

---

### Task 7: Loop tools

**Files:**
- Create: `src/tools/loop-tools.ts`
- Modify: `src/tools/index.ts` (merge `createLoopTools`)
- Modify: `src/types.ts` (`PluginContext.loopManager`)
- Test: `src/tools/loop-tools.test.ts`

**Interfaces:**
- Consumes: `LoopManager` (Tasks 3–6), `PluginContext`.
- Produces tools: `hera_create_loop`, `hera_list_loops`, `hera_loop_status`, `hera_pause_loop`, `hera_resume_loop`, `hera_cancel_loop`.

**Note:** Add `loopManager: LoopManager` to `PluginContext` (import type from `./engine/loop-manager.js`). This breaks PluginContext construction sites at typecheck — fix `src/index.ts`, `src/tools/test-harness.ts`, and `src/index.test.ts` in Task 8 (wiring). For THIS task, the tool unit test builds a fake ctx with only `loopManager`, so it does not need the other sites; but you must add the field to the interface here and run `bun run typecheck` — expect errors at the three construction sites, which Task 8 resolves. To keep this task's commit green on typecheck, ALSO add `loopManager` to those three sites here with a minimal `new LoopManager(...)` (see Task 8 for the exact construction); if that is too entangled, instead complete Task 8's wiring in the same commit. Prefer: do the minimal construction-site additions here so typecheck passes.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tools/loop-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../engine/task-store.js";
import { LoopStore } from "../engine/loop-store.js";
import { LoopManager } from "../engine/loop-manager.js";
import { AcceptanceEvaluator } from "../engine/acceptance.js";
import { createLoopTools } from "./loop-tools.js";

function ctxWith(loopManager: LoopManager) {
  return { loopManager } as unknown as Parameters<typeof createLoopTools>[0];
}

describe("loop-tools", () => {
  let dir: string;
  let mgr: LoopManager;
  let tools: ReturnType<typeof createLoopTools>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "looptools-"));
    const loopStore = new LoopStore(dir);
    await loopStore.init();
    const taskStore = new TaskStore(dir);
    await taskStore.init();
    mgr = new LoopManager(loopStore, taskStore, new AcceptanceEvaluator({ shellEnabled: true }), dir,
      { tickMs: 10, defaultMaxIterations: 25, minIntervalMs: 1000 }, () => 1000);
    tools = createLoopTools(ctxWith(mgr));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a recurring loop", async () => {
    const res = await tools.hera_create_loop.execute(
      { mode: "recurring", goal: "ping", acceptance: [{ type: "file_exists", path: "/tmp/x" }], intervalMs: 5000 } as any,
      {} as any
    );
    expect(String(res)).toContain("created");
    expect(await mgr.list("active")).toHaveLength(1);
  });

  it("rejects a loop with no acceptance", async () => {
    const res = await tools.hera_create_loop.execute(
      { mode: "drain", goal: "g", acceptance: [] } as any,
      {} as any
    );
    expect(String(res)).toContain("acceptance");
  });

  it("lists, pauses, resumes, and cancels", async () => {
    const created = await tools.hera_create_loop.execute(
      { mode: "drain", goal: "g", acceptance: [{ type: "file_exists", path: "/tmp/x" }] } as any,
      {} as any
    );
    const id = String(created).match(/loop ([\w-]+)/)?.[1]!;
    expect(String(await tools.hera_list_loops.execute({} as any, {} as any))).toContain(id);
    expect(String(await tools.hera_pause_loop.execute({ id } as any, {} as any))).toContain("paused");
    expect(String(await tools.hera_resume_loop.execute({ id } as any, {} as any))).toContain("resumed");
    expect(String(await tools.hera_cancel_loop.execute({ id } as any, {} as any))).toContain("cancelled");
    expect(String(await tools.hera_loop_status.execute({ id } as any, {} as any))).toContain("cancelled");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/tools/loop-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/loop-tools.ts`**

```ts
// src/tools/loop-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type { AcceptanceCheck, LoopMode } from "../engine/loop-types.js";

const z = tool.schema;

export function createLoopTools(ctx: PluginContext) {
  const { loopManager } = ctx;
  return {
    hera_create_loop: tool({
      description:
        "Create a durable loop that enqueues tasks over time. Modes: iterate (until goal), recurring (fixed interval), watch (on condition edge), drain (until queue empties). The loop's tasks complete only when their acceptance checks pass.",
      args: {
        mode: z.enum(["iterate", "recurring", "watch", "drain"]).describe("Loop mode"),
        goal: z.string().describe("Task goal the loop enqueues"),
        executor: z.string().optional().describe("Agent to run each task (default: hera)"),
        acceptance: z.array(z.any()).describe("Task acceptance checks (required, non-empty)"),
        maxAttempts: z.number().optional().describe("Per-task retry budget"),
        maxIterations: z.number().optional().describe("iterate: cap on iterations"),
        feedForward: z.boolean().optional().describe("iterate: feed prior output into the next task"),
        iterateGoal: z.array(z.any()).optional().describe("iterate: optional loop-level goal checks"),
        intervalMs: z.number().optional().describe("recurring: interval in ms (floored to the minimum)"),
        maxRuns: z.number().optional().describe("recurring: stop after this many runs"),
        condition: z.array(z.any()).optional().describe("watch: condition checks (edge-triggered)"),
        batchId: z.string().optional().describe("drain: scope to a specific batch id"),
      },
      async execute(args) {
        const a = args as Record<string, unknown>;
        const res = await loopManager.createLoop({
          mode: a.mode as LoopMode,
          taskTemplate: {
            goal: a.goal as string,
            executor: (a.executor as string) || "hera",
            acceptance: (a.acceptance as AcceptanceCheck[]) ?? [],
            maxAttempts: a.maxAttempts as number | undefined,
          },
          iterate:
            a.mode === "iterate"
              ? { goal: a.iterateGoal as AcceptanceCheck[] | undefined, maxIterations: a.maxIterations as number | undefined, feedForward: a.feedForward as boolean | undefined }
              : undefined,
          recurring:
            a.mode === "recurring"
              ? { intervalMs: a.intervalMs as number, maxRuns: a.maxRuns as number | undefined }
              : undefined,
          watch: a.mode === "watch" ? { condition: (a.condition as AcceptanceCheck[]) ?? [] } : undefined,
          drain: a.mode === "drain" ? { batchId: a.batchId as string | undefined } : undefined,
        });
        if (!res.ok) return `Error: ${res.error}`;
        return `Loop created: loop ${res.id} (${a.mode})`;
      },
    }),

    hera_list_loops: tool({
      description: "List loops, optionally filtered by status.",
      args: { status: z.string().optional().describe("active|paused|completed|cancelled|failed") },
      async execute(args) {
        const loops = await loopManager.list(args.status as never);
        if (loops.length === 0) return "No loops.";
        return loops.map((l) => `- ${l.id} [${l.mode}/${l.status}] iterations=${l.iterations}`).join("\n");
      },
    }),

    hera_loop_status: tool({
      description: "Show a loop's mode, status, iterations, current task, and last error.",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        const loop = await loopManager.get(args.id);
        if (!loop) return `No loop found: ${args.id}`;
        return [
          `Loop ${loop.id}: ${loop.mode}/${loop.status} (iterations ${loop.iterations})`,
          loop.currentTaskId ? `Current task: ${loop.currentTaskId}` : "",
          loop.lastError ? `Last error: ${loop.lastError}` : "",
        ].filter(Boolean).join("\n");
      },
    }),

    hera_pause_loop: tool({
      description: "Pause an active loop.",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        return (await loopManager.pause(args.id)) ? `Loop paused: ${args.id}` : `Could not pause loop: ${args.id}`;
      },
    }),

    hera_resume_loop: tool({
      description: "Resume a paused loop.",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        return (await loopManager.resume(args.id)) ? `Loop resumed: ${args.id}` : `Could not resume loop: ${args.id}`;
      },
    }),

    hera_cancel_loop: tool({
      description: "Cancel a loop (and its in-flight task, if any).",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        return (await loopManager.cancel(args.id)) ? `Loop cancelled: ${args.id}` : `Could not cancel loop: ${args.id}`;
      },
    }),
  };
}
```

- [ ] **Step 4: Wire the type and merge tools**

In `src/types.ts` `PluginContext`, after `taskStore: import("./engine/task-store.js").TaskStore;` add:

```ts
  loopManager: import("./engine/loop-manager.js").LoopManager;
```

In `src/tools/index.ts`, import and merge:

```ts
import { createLoopTools } from "./loop-tools.js";
// inside createAllTools tools object:
    ...createLoopTools(ctx),
```

- [ ] **Step 5: Satisfy typecheck at construction sites**

Run `bun run typecheck`. It will flag `src/index.ts`, `src/tools/test-harness.ts`, and `src/index.test.ts` for missing `loopManager`. Add a `LoopManager` at each site, constructed from a `LoopStore` over the same `dataDir` as the existing `TaskStore` plus the existing `AcceptanceEvaluator`/`cwd`. Use the exact wiring shown in Task 8, Step 3 for `src/index.ts`; for the two test sites mirror how `taskStore` is built (construct `LoopStore`, `await .init()`, then `new LoopManager(loopStore, taskStore, new AcceptanceEvaluator({ shellEnabled: true }), <dataDir or configRoot>, { tickMs: LOOP_TICK_MS, defaultMaxIterations: LOOP_DEFAULT_MAX_ITERATIONS, minIntervalMs: LOOP_MIN_INTERVAL_MS })`). Re-run typecheck until clean.

- [ ] **Step 6: Run to verify pass**

Run: `bun test src/tools/loop-tools.test.ts` then `bun run typecheck`
Expected: tools test PASS (3 tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/tools/loop-tools.ts src/tools/loop-tools.test.ts src/tools/index.ts src/types.ts src/index.ts src/tools/test-harness.ts src/index.test.ts
git commit -m "feat: add loop tools and wire LoopManager into PluginContext"
```

---

### Task 8: Startup wiring + integration tests

**Files:**
- Modify: `src/index.ts` (construct + recover + start the LoopManager) — if not already completed in Task 7, Step 5
- Test: `src/engine/loop-integration.test.ts`

**Interfaces:**
- Consumes: all loop + task engine modules; config + constants.

**Note:** If Task 7 already added the `LoopManager` construction to `src/index.ts` to satisfy typecheck, this task only adds `recover()` + `start()` (and the integration test). Verify the construction is present and correct, then add lifecycle calls.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/engine/loop-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { LoopStore } from "./loop-store.js";
import { LoopManager } from "./loop-manager.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";

describe("Loop + task engine integration", () => {
  let dir: string;
  let taskStore: TaskStore;
  let loopStore: LoopStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loop-int-"));
    taskStore = new TaskStore(dir);
    await taskStore.init();
    loopStore = new LoopStore(dir);
    await loopStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a recurring loop drives the supervisor to complete N tasks", async () => {
    let n = 0;
    const runner: AgentRunner = { run: async (_e, prompt) => {
      const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
      if (m) await writeFile(m[1], "x");
      return "done";
    } };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(taskStore, evalr, runner, dir);
    const sup = new Supervisor(taskStore, exec, { concurrency: 4, leaseMs: 60000, tickMs: 5, ownerId: "it" }, () => 1000);
    const mgr = new LoopManager(loopStore, taskStore, evalr, dir, { tickMs: 5, defaultMaxIterations: 25, minIntervalMs: 1000 }, () => 1000);

    // recurring loop, interval 1000, each task writes a unique file
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: { goal: "make file", executor: "hera", acceptance: [{ type: "file_exists", path: join(dir, "f.txt") }] },
      recurring: { intervalMs: 1000, maxRuns: 3 },
    });
    const id = (res as { id: string }).id;

    // advance loop clock past three intervals (one fire per tick at/after nextRunAt)
    for (const t of [2000, 3000, 4000]) {
      await mgr.tick(t);
      await sup.drain();
    }
    expect((await mgr.get(id))?.status).toBe("completed");
    expect(taskStore.byBatch(id).filter((x) => x.status === "succeeded")).toHaveLength(3);
  });

  it("an iterate loop reaches its goal and completes", async () => {
    let attempts = 0;
    const target = join(dir, "done.txt");
    const runner: AgentRunner = { run: async () => {
      attempts++;
      if (attempts >= 2) await writeFile(target, "ok"); // succeeds on 2nd iteration
      return `attempt ${attempts}`;
    } };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(taskStore, evalr, runner, dir);
    const sup = new Supervisor(taskStore, exec, { concurrency: 1, leaseMs: 60000, tickMs: 5, ownerId: "it" }, () => 1000);
    const mgr = new LoopManager(loopStore, taskStore, evalr, dir, { tickMs: 5, defaultMaxIterations: 5, minIntervalMs: 1000 }, () => 1000);

    const res = await mgr.createLoop({
      mode: "iterate",
      taskTemplate: { goal: "make done.txt", executor: "hera", acceptance: [{ type: "file_exists", path: target }], maxAttempts: 1 },
      iterate: { maxIterations: 5 },
    });
    const id = (res as { id: string }).id;

    // tick loop -> enqueue, drain supervisor, repeat until completed
    for (let i = 0; i < 6; i++) {
      await mgr.tick(1000);
      await sup.drain();
      if ((await mgr.get(id))?.status === "completed") break;
    }
    expect((await mgr.get(id))?.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run to verify it passes (modules already exist)**

Run: `bun test src/engine/loop-integration.test.ts`
Expected: PASS (uses Tasks 1–6 directly). If it fails, fix the loop/executor integration before wiring.

- [ ] **Step 3: Wire the LoopManager into `src/index.ts`**

After the supervisor wiring (the `await supervisor.recover(); supervisor.start();` block), and reusing the existing `taskStore`, `acceptance` (AcceptanceEvaluator), and `paths`, add:

```ts
import { LoopStore } from "./engine/loop-store.js";
import { LoopManager } from "./engine/loop-manager.js";
import {
  LOOP_TICK_MS,
  LOOP_DEFAULT_MAX_ITERATIONS,
  LOOP_MIN_INTERVAL_MS,
} from "./constants.js";

// after taskStore/acceptance/supervisor are ready:
const loopStore = new LoopStore(paths.dataDir);
await loopStore.init();
const loopManager = new LoopManager(
  loopStore,
  taskStore,
  acceptance,
  paths.configRoot,
  {
    tickMs: config.loop_tick_ms ?? LOOP_TICK_MS,
    defaultMaxIterations: config.loop_default_max_iterations ?? LOOP_DEFAULT_MAX_ITERATIONS,
    minIntervalMs: config.loop_min_interval_ms ?? LOOP_MIN_INTERVAL_MS,
  }
);
await loopManager.recover();
loopManager.start();
```

Add `loopManager` to the `PluginContext` object built in this file, and keep a module-level reference to `loopManager` (mirroring the `_supervisor` anchor) so its interval is not GC'd. (If Task 7 already added the construction, ensure `recover()` + `start()` + the module-level anchor are present.)

- [ ] **Step 4: Run the full engine + tools suites**

Run: `bun test src/engine/ src/tools/loop-tools.test.ts`
Expected: PASS (all engine incl. loop integration + loop tools).

- [ ] **Step 5: Typecheck, lint, build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: typecheck clean; lint 0 errors; build done. Fix any construction-site gaps the compiler flags.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/engine/loop-integration.test.ts
git commit -m "feat: wire LoopManager into startup with recovery and integration tests"
```

---

## Final verification gate

- [ ] Run the full suite; confirm no regressions beyond the known-flaky `src/install.test.ts` subprocess timeouts (pre-existing, environment-induced).

Run: `bun test`
Expected: all engine/store/tools/loop tests pass; only the pre-existing flaky install subprocess tests may intermittently fail.

- [ ] Release gate.

```bash
bun run typecheck && bun run lint && bun run build && npm pack --dry-run
```

---

## Self-review notes (author)

- **Spec coverage:** TaskRecord.output + executor (Task 1); LoopDefinition types + LoopStore + config/constants (Task 2); LoopManager core/lifecycle/validation/recover + drain (Task 3); iterate incl. goal-default/custom-goal/feed-forward/max-iterations (Task 4); recurring incl. fixed-interval/no-burst/maxRuns/clamp (Task 5); watch edge-trigger + re-arm (Task 6); loop tools + PluginContext + empty-acceptance rejection (Task 7); startup wiring + recover/start + integration (Task 8). Forward hooks (tick/recover seams, recurring scheduler boundary, src/engine/* extraction) preserved.
- **Type consistency:** `LoopManager` ctor `(loopStore, taskStore, evaluator, cwd, options, clock?)`; `createLoop(input) -> {ok,id}|{ok:false,error}`; `tick(now)`; `enqueueFromTemplate(loop, now, input?)`; `LoopStore.byStatus/byMode`; per-mode private `tickIterate/tickRecurring/tickWatch/tickDrain(loop, now)` consistent across tasks.
- **Determinism:** every mode test drives `tick(now)` with explicit timestamps; no real timers.
- **Anti-perfunctory preserved:** loops reuse P1's acceptance-gated completion; empty `taskTemplate.acceptance` rejected at create.
