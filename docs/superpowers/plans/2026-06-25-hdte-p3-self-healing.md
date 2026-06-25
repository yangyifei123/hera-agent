# HDTE P3 — Self-Healing + Scheduled Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HDTE engine self-healing at runtime — attempt timeouts for hung agents, periodic lease reclaim of orphaned tasks, a loop failure circuit-breaker, and team-session recovery — plus recovery/health tools.

**Architecture:** Additive changes to P1's `TaskExecutor`/`Supervisor` and P2's `LoopManager`, plus `TeamManager.recoverSessions()` and three recovery tools. Everything stays in-process and deterministic under the injectable clock.

**Tech Stack:** TypeScript, Bun (`bun:test`), `@opencode-ai/plugin` `tool()`.

## Global Constraints

- All P3 changes are additive or guarded; existing P1/P2 engine + loop tests must stay green.
- `attemptTimeoutMs` default (240000) is strictly less than `TASK_LEASE_MS` (300000) so the supervisor never reclaims a task it is still executing.
- The loop circuit-breaker is stateless: compute the trailing run of consecutive failed spawned tasks from `taskStore.byBatch(loop.id)` each tick; any success breaks the run. No new `LoopDefinition` field.
- Tests deterministic: drive `tick(now)`/`dispatchOnce()` with controlled timestamps; never rely on real timers. Timeout tests use a never-resolving runner + a tiny `attemptTimeoutMs` and a REAL short timeout (acceptable: the timeout fires in milliseconds).
- `heraLog()` never `console.*`; constants from `src/constants.ts`.
- Tests live next to source, `*.test.ts`. Windows: judge `bun test` by bun's "N pass, M fail" line, not the PowerShell exit code; run git/shell via the PowerShell tool.
- Commit message bodies end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Executor attempt timeout

**Files:**
- Modify: `src/engine/executor.ts`
- Modify: `src/constants.ts` (add `TASK_ATTEMPT_TIMEOUT_MS`)
- Modify: `src/types.ts` (`HeraConfig.task_attempt_timeout_ms?`)
- Test: `src/engine/executor.test.ts`, `src/constants.test.ts`

**Interfaces:**
- Produces: `TaskExecutor` constructor gains a 5th optional param `attemptTimeoutMs?: number` (default 0 = no timeout). On timeout, `runner.run` is abandoned and the attempt fails as an agent error.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/executor.test.ts` (inside `describe("TaskExecutor", ...)`):

```ts
  it("fails an attempt when the agent runner exceeds the attempt timeout", async () => {
    const runner: AgentRunner = { run: () => new Promise<string>(() => {}) }; // never resolves
    const exec = new TaskExecutor(store, evalr, runner, dir, 30); // 30ms timeout
    const task = makeTask({ attempts: 1, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.lastError).toContain("timed out");
  });

  it("does not time out a fast runner under the limit", async () => {
    const target = join(dir, "fast.txt");
    const runner: AgentRunner = { run: async () => { await writeFile(target, "x"); return "ok"; } };
    const exec = new TaskExecutor(store, evalr, runner, dir, 5000);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: target }] });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("succeeded");
  });
```

Append to `src/constants.test.ts` (add import + describe):

```ts
// add TASK_ATTEMPT_TIMEOUT_MS to the import from "./constants.js"
import { TASK_ATTEMPT_TIMEOUT_MS, TASK_LEASE_MS } from "./constants.js";
describe("Self-Healing Constants", () => {
  it("attempt timeout is below the lease", () => {
    expect(TASK_ATTEMPT_TIMEOUT_MS).toBe(240000);
    expect(TASK_ATTEMPT_TIMEOUT_MS).toBeLessThan(TASK_LEASE_MS);
  });
});
```

(If `TASK_LEASE_MS` is already imported in that file, don't duplicate it.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/executor.test.ts src/constants.test.ts`
Expected: FAIL (timeout not implemented; constant missing).

- [ ] **Step 3: Add the constant + config field**

In `src/constants.ts`, in the Task Engine Configuration block, add:

```ts
/** Default per-attempt agent timeout (ms); must be < TASK_LEASE_MS. */
export const TASK_ATTEMPT_TIMEOUT_MS = 240000;
```

In `src/types.ts` `HeraConfig`, after `task_lease_ms?: number;` add:

```ts
  task_attempt_timeout_ms?: number;
```

- [ ] **Step 4: Implement the timeout in `src/engine/executor.ts`**

Add a module-level helper above the class:

```ts
function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`attempt timed out after ${ms}ms`)), ms);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
```

Add the constructor param (5th):

```ts
  constructor(
    private store: TaskStore,
    private evaluator: AcceptanceEvaluator,
    private runner: AgentRunner,
    private cwd: string,
    private attemptTimeoutMs: number = 0
  ) {}
```

In `runAttempt`, change the runner call:

```ts
    try {
      output = await raceWithTimeout(this.runner.run(task.executor, prompt), this.attemptTimeoutMs);
    } catch (err) {
      agentError = err instanceof Error ? err.message : String(err);
    }
```

(The existing agent-error path turns this into a failed attempt; `lastError` becomes `agent error: attempt timed out after 30ms`, which contains "timed out".)

- [ ] **Step 5: Run to verify pass + no regression**

Run: `bun test src/engine/ src/constants.test.ts`
Expected: PASS (new tests + all existing engine tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/executor.ts src/engine/executor.test.ts src/constants.ts src/constants.test.ts src/types.ts
git commit -m "feat: add per-attempt agent timeout so hung agents fail bounded"
```

---

### Task 2: Supervisor periodic reclaim + stats

**Files:**
- Modify: `src/engine/supervisor.ts`
- Test: `src/engine/supervisor.test.ts`

**Interfaces:**
- Produces: `Supervisor.stats(): { active: number; reclaimed: number; concurrency: number }`. `dispatchOnce` reclaims expired-lease orphans each call.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/supervisor.test.ts` (inside the existing top-level `describe("Supervisor", ...)`, reusing its `buildSupervisor`/`store`/`dir` fixtures — match the file's existing helper names):

```ts
  it("reclaims an orphaned running task mid-run and completes it", async () => {
    const runner: AgentRunner = { run: async (_e, prompt) => {
      const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
      if (m) await writeFile(m[1], "x");
      return "done";
    } };
    const sup = buildSupervisor(runner, 4);
    // a task stuck "running" with an EXPIRED lease (orphaned by a dead prior attempt)
    await store.save({
      ...makeTask("orphan", join(dir, "orphan.txt")),
      status: "running", leaseOwner: "dead", leaseExpiresAt: 1,
    });
    await sup.drain();
    expect(store.byStatus("succeeded").map((t) => t.id)).toContain("orphan");
    expect(sup.stats().reclaimed).toBeGreaterThanOrEqual(1);
  });
```

(`buildSupervisor` in this file constructs with clock `() => 1000`; the orphan's `leaseExpiresAt: 1` is in the past, so reclaim fires. `makeTask(id, target)` is the file's existing helper.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/supervisor.test.ts`
Expected: FAIL — `sup.stats` not a function / orphan never reclaimed.

- [ ] **Step 3: Implement in `src/engine/supervisor.ts`**

Add a field:

```ts
  private reclaimedCount = 0;
```

In `dispatchOnce`, right after `this.dispatching = true;` and inside the `try`, before computing `slots`:

```ts
      this.reclaimedCount += await this.store.recover(this.clock());
```

Add the method (e.g. after `activeCount`):

```ts
  stats(): { active: number; reclaimed: number; concurrency: number } {
    return {
      active: this.active.size,
      reclaimed: this.reclaimedCount,
      concurrency: this.options.concurrency,
    };
  }
```

- [ ] **Step 4: Run to verify pass + no regression**

Run: `bun test src/engine/supervisor.test.ts src/engine/`
Expected: PASS (new test + all existing supervisor/engine tests — existing tests have no expired-lease tasks, so reclaim is a no-op for them).

- [ ] **Step 5: Commit**

```bash
git add src/engine/supervisor.ts src/engine/supervisor.test.ts
git commit -m "feat: reclaim orphaned running tasks each supervisor tick + stats()"
```

---

### Task 3: Loop circuit-breaker (stateless) + constants

**Files:**
- Modify: `src/engine/loop-manager.ts` (`advance`; recurring/watch set `currentTaskId`)
- Modify: `src/constants.ts` (`LOOP_MAX_CONSECUTIVE_FAILURES`)
- Modify: `src/types.ts` (`HeraConfig.loop_max_consecutive_failures?`)
- Test: `src/engine/loop-manager.test.ts`, `src/constants.test.ts`

**Interfaces:**
- Consumes: `LoopManagerOptions` gains `maxConsecutiveFailures: number`. The circuit-breaker reads `taskStore.byBatch(loop.id)`.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` to `src/engine/loop-manager.test.ts` (reuse the file's helpers; the `OPTS` constant there must gain `maxConsecutiveFailures` — update the shared `OPTS` to `{ tickMs: 10, defaultMaxIterations: 25, minIntervalMs: 1000, maxConsecutiveFailures: 3 }`):

```ts
describe("LoopManager circuit-breaker", () => {
  let dir: string;
  let loopStore: LoopStore;
  let taskStore: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopcb-"));
    loopStore = new LoopStore(dir);
    await loopStore.init();
    taskStore = new TaskStore(dir);
    await taskStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("trips a recurring loop to failed after N consecutive task failures", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000); // OPTS.maxConsecutiveFailures = 3
    const res = await mgr.createLoop({ mode: "recurring", taskTemplate: template, recurring: { intervalMs: 1000 } });
    const id = (res as { id: string }).id;
    // simulate 3 prior failed spawned tasks for this loop's batch
    for (let i = 0; i < 3; i++) {
      await taskStore.save({
        id: `f${i}`, batchId: id, goal: "g", executor: "hera",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        status: "failed", attempts: 3, maxAttempts: 3, createdAt: i, updatedAt: i, completedAt: i,
      });
    }
    await mgr.tick(5000);
    expect((await mgr.get(id))?.status).toBe("failed");
    expect((await mgr.get(id))?.lastError).toContain("circuit-breaker");
  });

  it("a later success resets the trailing-failure run (no trip)", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({ mode: "recurring", taskTemplate: template, recurring: { intervalMs: 1000 } });
    const id = (res as { id: string }).id;
    await taskStore.save({ id: "f1", batchId: id, goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }], status: "failed", attempts: 3, maxAttempts: 3, createdAt: 1, updatedAt: 1, completedAt: 1 });
    await taskStore.save({ id: "f2", batchId: id, goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }], status: "failed", attempts: 3, maxAttempts: 3, createdAt: 2, updatedAt: 2, completedAt: 2 });
    await taskStore.save({ id: "s1", batchId: id, goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }], status: "succeeded", attempts: 1, maxAttempts: 3, createdAt: 3, updatedAt: 3, completedAt: 3 });
    await mgr.tick(2000); // trailing run is 0 (last terminal is succeeded) -> no trip; recurring fires
    expect((await mgr.get(id))?.status).toBe("active");
  });
});
```

Append to `src/constants.test.ts`:

```ts
// add LOOP_MAX_CONSECUTIVE_FAILURES to the import from "./constants.js"
it("loop max consecutive failures default", () => {
  expect(LOOP_MAX_CONSECUTIVE_FAILURES).toBe(5);
});
```

(Place this `it` inside an existing or new describe block; ensure the import line includes `LOOP_MAX_CONSECUTIVE_FAILURES`.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/engine/loop-manager.test.ts src/constants.test.ts`
Expected: FAIL — breaker not implemented; option/constant missing.

- [ ] **Step 3: Add the constant + config**

In `src/constants.ts` Loop Engine Configuration block:

```ts
/** Trip a loop to failed after this many consecutive failed spawned tasks. */
export const LOOP_MAX_CONSECUTIVE_FAILURES = 5;
```

In `src/types.ts` `HeraConfig`:

```ts
  loop_max_consecutive_failures?: number;
```

- [ ] **Step 4: Implement in `src/engine/loop-manager.ts`**

Add `maxConsecutiveFailures: number;` to the `LoopManagerOptions` interface.

In `advance(loop, now)`, BEFORE the mode `switch`, insert the breaker:

```ts
    const terminal = this.taskStore
      .byBatch(loop.id)
      .filter((t) => t.status === "failed" || t.status === "succeeded")
      .sort((a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt));
    let trailing = 0;
    for (let i = terminal.length - 1; i >= 0; i--) {
      if (terminal[i].status === "failed") trailing++;
      else break;
    }
    if (trailing >= this.options.maxConsecutiveFailures) {
      await this.loopStore.save({
        ...loop,
        status: "failed",
        lastError: `loop circuit-breaker: ${trailing} consecutive task failures`,
        updatedAt: now,
      });
      return;
    }
```

In `tickRecurring`, when it enqueues, capture the id and persist `currentTaskId`. Change the enqueue + save so the spawned id is recorded:

```ts
    const taskId = await this.enqueueFromTemplate(loop, now);
    // ... existing runs/nextRunAt computation ...
    await this.loopStore.save({
      ...loop,
      recurring: { ...cfg, runs, nextRunAt },
      currentTaskId: taskId,
      iterations: loop.iterations + 1,
      status: completed ? "completed" : loop.status,
      updatedAt: now,
    });
```

In `tickWatch`, similarly record the spawned id on the rising edge:

```ts
    let iterations = loop.iterations;
    let currentTaskId = loop.currentTaskId;
    if (met && !cfg.lastConditionMet) {
      currentTaskId = await this.enqueueFromTemplate(loop, now);
      iterations += 1;
    }
    await this.loopStore.save({
      ...loop,
      watch: { ...cfg, lastConditionMet: met },
      currentTaskId,
      iterations,
      updatedAt: now,
    });
```

- [ ] **Step 5: Update all `LoopManagerOptions` construction sites**

`bun run typecheck` will flag every place that builds `LoopManagerOptions` without `maxConsecutiveFailures`: the test helper `OPTS` (already updated in Step 1), `src/index.ts`, `src/tools/test-harness.ts`, and `src/index.test.ts`. Add `maxConsecutiveFailures: config.loop_max_consecutive_failures ?? LOOP_MAX_CONSECUTIVE_FAILURES` in `src/index.ts` (import the constant) and `maxConsecutiveFailures: LOOP_MAX_CONSECUTIVE_FAILURES` (or a literal `5`) in the two test sites. Re-run typecheck until clean.

- [ ] **Step 6: Run to verify pass + no regression**

Run: `bun test src/engine/loop-manager.test.ts src/engine/ src/constants.test.ts && bun run typecheck`
Expected: PASS; typecheck clean. Existing loop tests stay green (no loop in them accrues ≥5 trailing failures; the breaker default in those is 5 via the unchanged constant unless their OPTS sets 3 — note the test `OPTS` now sets 3, so verify existing loop-manager tests don't spawn ≥3 consecutive failing tasks for one loop; the iterate "fails when maxIterations reached" test uses maxIterations:1 with one failed task → trailing 1 < 3, safe).

- [ ] **Step 7: Commit**

```bash
git add src/engine/loop-manager.ts src/engine/loop-manager.test.ts src/constants.ts src/constants.test.ts src/types.ts src/index.ts src/tools/test-harness.ts src/index.test.ts
git commit -m "feat: add stateless loop failure circuit-breaker"
```

---

### Task 4: TeamManager session recovery

**Files:**
- Modify: `src/team/manager.ts`
- Test: `src/team/manager.test.ts` (create if absent)

**Interfaces:**
- Produces: `TeamManager.recoverSessions(): Promise<number>` — re-polls non-terminal spawned sessions and reconciles their status; returns the count changed.

- [ ] **Step 1: Write the failing test**

Create or append `src/team/manager.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "./manager.js";

function fakeClient(statusById: Record<string, { type: string }>, messages: Record<string, string> = {}) {
  return {
    session: {
      status: async () => ({ data: statusById }),
      messages: async ({ path }: { path: { id: string } }) => ({
        data: [{ info: { role: "assistant" }, parts: [{ text: messages[path.id] ?? "" }] }],
      }),
      create: async () => ({ data: { id: "x" } }),
      promptAsync: async () => ({}),
    },
  } as never;
}

describe("TeamManager.recoverSessions", () => {
  let dir: string;
  let store: MemoryStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "teamrec-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reconciles an idle session to completed with captured result", async () => {
    const client = fakeClient({ s1: { type: "idle" } }, { s1: "FINAL ANSWER" });
    const mgr = new TeamManager(store, client);
    await mgr.createTeam({ name: "t", description: "d", members: [{ agentName: "a", role: "dev" }], coordination: "parallel" } as never);
    // seed a spawned session in a non-terminal state
    await store.save({ id: "team-session-t", type: "team-session", content: JSON.stringify({ teamName: "t", sessions: [{ agentName: "a", sessionId: "s1", status: "running" }] }), timestamp: 1 });
    await mgr.init(); // reloads sessions (running -> unknown)
    const changed = await mgr.recoverSessions();
    expect(changed).toBeGreaterThanOrEqual(1);
    const sessions = mgr.getSpawnedSessions("t");
    expect(sessions.find((s) => s.sessionId === "s1")?.status).toBe("completed");
  });

  it("returns 0 with no client", async () => {
    const mgr = new TeamManager(store, undefined);
    const changed = await mgr.recoverSessions();
    expect(changed).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/team/manager.test.ts`
Expected: FAIL — `recoverSessions` not defined.

- [ ] **Step 3: Implement `recoverSessions` in `src/team/manager.ts`**

Add the method to the `TeamManager` class (it already has `this.client`, `this.spawnedSessions`, `teamSessionMemoryId`, and a `store`):

```ts
  async recoverSessions(): Promise<number> {
    if (!this.client || typeof this.client.session?.status !== "function") return 0;
    let changed = 0;
    for (const [teamName, sessions] of this.spawnedSessions.entries()) {
      let mutated = false;
      for (const session of sessions) {
        if (session.status !== "unknown" && session.status !== "running" && session.status !== "pending") {
          continue;
        }
        try {
          const statusResult = await this.client.session.status();
          const type = statusResult.data?.[session.sessionId]?.type;
          if (type === "idle") {
            const messagesResult = await this.client.session.messages({ path: { id: session.sessionId } });
            const messages = messagesResult.data ?? [];
            let result = "";
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i]?.info.role === "assistant") {
                result = messages[i].parts?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
                break;
              }
            }
            session.status = "completed";
            session.result = result;
            mutated = true;
            changed++;
          }
        } catch {
          session.status = "error";
          mutated = true;
          changed++;
        }
      }
      if (mutated) {
        await this.store.save({
          id: teamSessionMemoryId(teamName),
          type: "team-session",
          content: JSON.stringify({ teamName, sessions }),
          timestamp: Date.now(),
          metadata: { sessionCount: sessions.length },
        });
      }
    }
    return changed;
  }
```

(If `teamSessionMemoryId` is a module-level function in this file, call it directly; it already exists.)

- [ ] **Step 4: Run to verify pass + no regression**

Run: `bun test src/team/manager.test.ts`
Expected: PASS (2 tests). Also run `bun test src/tools/team-tools.test.ts` if present to confirm no TeamManager regression.

- [ ] **Step 5: Commit**

```bash
git add src/team/manager.ts src/team/manager.test.ts
git commit -m "feat: add TeamManager.recoverSessions for crashed-session reconciliation"
```

---

### Task 5: Recovery + health tools

**Files:**
- Create: `src/tools/recovery-tools.ts`
- Modify: `src/tools/index.ts` (merge `createRecoveryTools`)
- Modify: `src/types.ts` (`PluginContext.supervisor`)
- Test: `src/tools/recovery-tools.test.ts`

**Interfaces:**
- Consumes: `TaskStore`, `LoopManager` (via `loopManager.list`), `TeamManager`, `Supervisor` from `PluginContext`.
- Produces tools: `hera_recover`, `hera_engine_health`, `hera_recover_sessions`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tools/recovery-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../engine/task-store.js";
import { createRecoveryTools } from "./recovery-tools.js";

function ctx(taskStore: TaskStore, supervisor: unknown, loopManager: unknown, teamManager: unknown) {
  return { taskStore, supervisor, loopManager, teamManager } as unknown as Parameters<typeof createRecoveryTools>[0];
}

describe("recovery-tools", () => {
  let dir: string;
  let taskStore: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rectools-"));
    taskStore = new TaskStore(dir);
    await taskStore.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("hera_recover resets expired-lease running tasks and reports the count", async () => {
    await taskStore.save({
      id: "orphan", goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "running", attempts: 1, maxAttempts: 3, leaseOwner: "dead", leaseExpiresAt: 1, createdAt: 1, updatedAt: 1,
    });
    const tools = createRecoveryTools(ctx(taskStore, { stats: () => ({ active: 0, reclaimed: 0, concurrency: 8 }) }, { list: async () => [] }, {}));
    const res = await tools.hera_recover.execute({} as any, {} as any);
    expect(String(res)).toContain("1");
    expect(taskStore.byStatus("pending").map((t) => t.id)).toContain("orphan");
  });

  it("hera_engine_health reports task and supervisor stats", async () => {
    await taskStore.save({ id: "a", goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }], status: "succeeded", attempts: 1, maxAttempts: 3, createdAt: 1, updatedAt: 1 });
    const tools = createRecoveryTools(ctx(taskStore, { stats: () => ({ active: 2, reclaimed: 3, concurrency: 8 }) }, { list: async () => [{ id: "l", mode: "drain", status: "active", iterations: 0 }] }, {}));
    const res = await tools.hera_engine_health.execute({} as any, {} as any);
    expect(String(res)).toContain("succeeded");
    expect(String(res)).toContain("reclaimed");
  });

  it("hera_recover_sessions reports the reconciled count", async () => {
    const tools = createRecoveryTools(ctx(taskStore, { stats: () => ({ active: 0, reclaimed: 0, concurrency: 8 }) }, { list: async () => [] }, { recoverSessions: async () => 2 }));
    const res = await tools.hera_recover_sessions.execute({} as any, {} as any);
    expect(String(res)).toContain("2");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/tools/recovery-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/recovery-tools.ts`**

```ts
// src/tools/recovery-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type { TaskStatus } from "../engine/task-types.js";

export function createRecoveryTools(ctx: PluginContext) {
  const { taskStore, supervisor, loopManager, teamManager } = ctx;
  return {
    hera_recover: tool({
      description: "Reclaim orphaned tasks: reset expired-lease 'running' tasks back to 'pending' so they re-run.",
      args: {},
      async execute() {
        const count = await taskStore.recover(Date.now());
        return `Recovered ${count} orphaned task(s) (reset to pending).`;
      },
    }),

    hera_engine_health: tool({
      description: "Report task-engine and loop-engine health: task counts by status, loop counts by status, and supervisor stats.",
      args: {},
      async execute() {
        const statuses: TaskStatus[] = ["pending", "running", "succeeded", "failed", "cancelled"];
        const taskLine = statuses.map((s) => `${s}=${taskStore.byStatus(s).length}`).join(" ");
        const loops = await loopManager.list();
        const loopCounts = loops.reduce<Record<string, number>>((acc, l) => {
          acc[l.status] = (acc[l.status] ?? 0) + 1;
          return acc;
        }, {});
        const loopLine = Object.entries(loopCounts).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
        const s = supervisor.stats();
        return [
          `Tasks: ${taskLine}`,
          `Loops: ${loopLine}`,
          `Supervisor: active=${s.active} reclaimed=${s.reclaimed} concurrency=${s.concurrency}`,
        ].join("\n");
      },
    }),

    hera_recover_sessions: tool({
      description: "Reconcile crashed/unknown team sessions by re-polling their status.",
      args: {},
      async execute() {
        const count = await teamManager.recoverSessions();
        return `Reconciled ${count} team session(s).`;
      },
    }),
  };
}
```

- [ ] **Step 4: Add `supervisor` to PluginContext and merge tools**

In `src/types.ts` `PluginContext`, after `loopManager: ...;` add:

```ts
  supervisor: import("./engine/supervisor.js").Supervisor;
```

In `src/tools/index.ts`, import and merge:

```ts
import { createRecoveryTools } from "./recovery-tools.js";
// inside createAllTools tools object:
    ...createRecoveryTools(ctx),
```

- [ ] **Step 5: Fix construction sites for `supervisor`**

`bun run typecheck` flags `src/index.ts`, `src/tools/test-harness.ts`, `src/index.test.ts` for missing `supervisor` in the ctx. In `src/index.ts` the `supervisor` variable already exists — add `supervisor` to the ctx object. In the two test sites, the harness currently has no supervisor; construct one: `new Supervisor(taskStore, taskExecutor-or-a-TaskExecutor, { concurrency: TASK_CONCURRENCY, leaseMs: TASK_LEASE_MS, tickMs: SUPERVISOR_TICK_MS, ownerId: "test" })` (import `Supervisor` + a minimal `TaskExecutor` with `new AcceptanceEvaluator(...)` and a stub `AgentRunner` whose `run` throws — the harness/sync-ctx tests don't run the supervisor, they only need the field to type-check). Mirror how `taskStore`/`loopManager` were added. Re-run typecheck until clean.

- [ ] **Step 6: Run to verify pass + no regression**

Run: `bun test src/tools/recovery-tools.test.ts && bun run typecheck && bun test src/tools/agent-tools.test.ts`
Expected: recovery tools 3 pass; typecheck clean; agent-tools no regression.

- [ ] **Step 7: Commit**

```bash
git add src/tools/recovery-tools.ts src/tools/recovery-tools.test.ts src/tools/index.ts src/types.ts src/index.ts src/tools/test-harness.ts src/index.test.ts
git commit -m "feat: add recovery + engine-health tools and PluginContext.supervisor"
```

---

### Task 6: Startup wiring + integration

**Files:**
- Modify: `src/index.ts` (executor attempt timeout from config; best-effort team recovery at startup)
- Test: `src/engine/self-healing-integration.test.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/engine/self-healing-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";

describe("self-healing integration", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "heal-int-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("times out a hung task while completing a healthy one", async () => {
    const healthy = join(dir, "ok.txt");
    const runner: AgentRunner = { run: (_e, prompt) => {
      if (prompt.includes("hang")) return new Promise<string>(() => {}); // never resolves
      return (async () => { await writeFile(healthy, "x"); return "done"; })();
    } };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir, 40); // 40ms attempt timeout
    const sup = new Supervisor(store, exec, { concurrency: 4, leaseMs: 60000, tickMs: 5, ownerId: "it" }, () => 1000);

    await store.save({ id: "hung", goal: "hang forever", executor: "hera", acceptance: [{ type: "file_exists", path: join(dir, "never") }], status: "pending", attempts: 0, maxAttempts: 1, createdAt: 1, updatedAt: 1 });
    await store.save({ id: "good", goal: "make ok", executor: "hera", acceptance: [{ type: "file_exists", path: healthy }], status: "pending", attempts: 0, maxAttempts: 1, createdAt: 1, updatedAt: 1 });

    await sup.drain();
    expect(store.byStatus("succeeded").map((t) => t.id)).toContain("good");
    expect(store.byStatus("failed").map((t) => t.id)).toContain("hung");
  }, 20000);
});
```

- [ ] **Step 2: Run to verify it passes (modules exist)**

Run: `bun test src/engine/self-healing-integration.test.ts`
Expected: PASS (uses Tasks 1–2 directly). If it fails, fix the timeout/drain interaction.

- [ ] **Step 3: Wire config into `src/index.ts`**

Where `TaskExecutor` is constructed, pass the attempt timeout from config:

```ts
const taskExecutor = new TaskExecutor(
  taskStore,
  acceptance,
  agentRunner,
  paths.configRoot,
  config.task_attempt_timeout_ms ?? TASK_ATTEMPT_TIMEOUT_MS
);
```

Import `TASK_ATTEMPT_TIMEOUT_MS`. After the managers are initialized and the client is available, add a best-effort team recovery (non-fatal):

```ts
try {
  const reconciled = await teamManager.recoverSessions();
  if (reconciled > 0) heraLog("info", `Recovered ${reconciled} team session(s) on startup`);
} catch (err) {
  heraLog("warn", "Team session recovery failed on startup", err);
}
```

(Place it after `teamManager` is constructed/initialized; `heraLog` is already imported in index.ts.)

- [ ] **Step 4: Full gate**

Run: `bun test src/engine/ src/tools/recovery-tools.test.ts src/team/manager.test.ts && bun run typecheck && bun run lint && bun run build`
Expected: all pass; typecheck clean; lint 0 errors; build done.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/engine/self-healing-integration.test.ts
git commit -m "feat: wire attempt timeout + startup team-session recovery"
```

---

## Final verification gate

```bash
bun run typecheck && bun run lint && bun run build && bun test
```

Only the pre-existing flaky `src/install.test.ts` subprocess tests may intermittently fail.

## Self-review notes (author)

- **Coverage:** attempt timeout (T1); periodic reclaim + stats (T2); stateless circuit-breaker + recurring/watch currentTaskId (T3); team recoverSessions (T4); recovery/health tools + PluginContext.supervisor (T5); wiring + hung-task integration (T6). All additive; existing tests guarded.
- **Type consistency:** `TaskExecutor(store, evaluator, runner, cwd, attemptTimeoutMs?)`; `Supervisor.stats()`; `LoopManagerOptions.maxConsecutiveFailures`; `TeamManager.recoverSessions()`; `PluginContext.supervisor`.
- **Safety:** `attemptTimeoutMs (240000) < TASK_LEASE_MS (300000)`; reclaim never touches in-flight (future-lease) tasks; circuit-breaker stateless/self-correcting.
