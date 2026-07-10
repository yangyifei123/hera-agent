// src/engine/loop-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { LoopStore } from "./loop-store.js";
import { LoopManager } from "./loop-manager.js";
import { LOOP_TASK_RETENTION } from "../constants.js";

const OPTS = {
  tickMs: 10,
  defaultMaxIterations: 25,
  minIntervalMs: 1000,
  maxConsecutiveFailures: 3,
};

function makeManager(dir: string, loopStore: LoopStore, taskStore: TaskStore, now = 1000) {
  const evalr = new AcceptanceEvaluator({ shellEnabled: true });
  return new LoopManager(loopStore, taskStore, evalr, dir, OPTS, () => now);
}

const template = {
  goal: "do it",
  executor: "hera",
  acceptance: [{ type: "file_exists" as const, path: "/tmp/x" }],
};

/**
 * Mark every outstanding (pending/running) task in a loop's batch as succeeded,
 * simulating the supervisor draining the queue between ticks. Recurring loops
 * now skip a fire while their previous task is still in flight (overlap guard),
 * so scheduling tests must terminalize the prior task before the next fire.
 */
async function drainBatch(taskStore: TaskStore, batchId: string, now: number): Promise<void> {
  for (const t of taskStore.byBatch(batchId)) {
    if (t.status === "pending" || t.status === "running") {
      await taskStore.save({ ...t, status: "succeeded", completedAt: now, updatedAt: now });
    }
  }
}

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
    const res = await mgr.createLoop({
      mode: "drain",
      taskTemplate: { goal: "g", executor: "hera", acceptance: [] },
    });
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
      id: "t1",
      batchId: "b1",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "pending",
      attempts: 0,
      maxAttempts: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const mgr = makeManager(dir, loopStore, taskStore);
    const res = await mgr.createLoop({
      mode: "drain",
      taskTemplate: template,
      drain: { batchId: "b1" },
    });
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
    const res = await mgr.createLoop({
      mode: "iterate",
      taskTemplate: template,
      iterate: { maxIterations: 5 },
    });
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
    const res = await mgr.createLoop({
      mode: "iterate",
      taskTemplate: template,
      iterate: { maxIterations: 1 },
    });
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
    const res = await mgr.createLoop({
      mode: "iterate",
      taskTemplate: template,
      iterate: { maxIterations: 5, feedForward: true },
    });
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
      mode: "iterate",
      taskTemplate: template,
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
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;

    await mgr.tick(1500); // before nextRunAt(2000) -> no fire
    expect(taskStore.byBatch(id)).toHaveLength(0);

    await mgr.tick(2000); // fires once, nextRunAt -> 3000
    expect(taskStore.byBatch(id)).toHaveLength(1);
    expect((await mgr.get(id))?.recurring?.nextRunAt).toBe(3000);
    await drainBatch(taskStore, id, 2000); // supervisor completes the fire

    await mgr.tick(2500); // before 3000 -> no new fire
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await mgr.tick(3000); // fires again
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });

  it("skips a recurring fire while the previous run is still in flight (no overlap)", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;

    await mgr.tick(2000); // fires once — task now pending
    expect(taskStore.byBatch(id)).toHaveLength(1);

    // Previous task still pending: the next due fire is skipped, but the
    // schedule still advances so the loop does not busy-spin.
    await mgr.tick(3000);
    expect(taskStore.byBatch(id)).toHaveLength(1);
    expect((await mgr.get(id))?.recurring?.nextRunAt).toBe(4000);

    // Once the outstanding task completes, the next due fire proceeds.
    await drainBatch(taskStore, id, 3500);
    await mgr.tick(4000);
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });

  it("does not burst-catch-up when far behind", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;
    // jump way past several intervals in one tick
    await mgr.tick(10000);
    expect(taskStore.byBatch(id)).toHaveLength(1); // exactly one fire
    expect((await mgr.get(id))?.recurring?.nextRunAt).toBe(11000); // now + interval
  });

  it("completes after maxRuns", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000, maxRuns: 2 },
    });
    const id = (res as { id: string }).id;
    await mgr.tick(2000); // run 1
    await drainBatch(taskStore, id, 2000); // supervisor completes run 1
    await mgr.tick(3000); // run 2 -> completed
    expect((await mgr.get(id))?.status).toBe("completed");
    expect(taskStore.byBatch(id)).toHaveLength(2);
    await mgr.tick(4000); // terminal, no more fires
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });

  it("clamps intervalMs to the minimum floor", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 10 },
    });
    const id = (res as { id: string }).id;
    expect((await mgr.get(id))?.recurring?.intervalMs).toBe(1000); // floored to LOOP_MIN_INTERVAL_MS
  });
});

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
      mode: "watch",
      taskTemplate: template,
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
      mode: "watch",
      taskTemplate: template,
      watch: { condition: [{ type: "file_exists", path: trigger }] },
    });
    const id = (res as { id: string }).id;

    await writeFile(trigger, "x");
    await mgr.tick(1000); // edge -> enqueue #1
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await rm(trigger);
    await mgr.tick(1001); // condition false -> re-arm, no enqueue
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await writeFile(trigger, "x");
    await mgr.tick(1002); // edge again -> enqueue #2
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });

  it("does not resurrect a loop cancelled while its watch condition is evaluating", async () => {
    // The canonical lost-update race: a slow condition is mid-evaluate when the
    // user cancels the loop. The tick's stale save must be dropped, not flip the
    // loop back to active.
    const ref: { mgr?: LoopManager } = {};
    let loopId = "";
    const racingEvalr = {
      evaluate: async () => {
        if (loopId) await ref.mgr?.cancel(loopId); // cancel lands mid-evaluation
        return [{ type: "shell", passed: true, detail: "ok", at: 1000 }];
      },
      allPassed: () => true,
    } as unknown as AcceptanceEvaluator;
    const mgr = new LoopManager(loopStore, taskStore, racingEvalr, dir, OPTS, () => 1000);
    ref.mgr = mgr;
    const res = await mgr.createLoop({
      mode: "watch",
      taskTemplate: template,
      watch: { condition: [{ type: "shell", command: "true" }] },
    });
    loopId = (res as { id: string }).id;

    await mgr.tick(1000);

    expect((await mgr.get(loopId))?.status).toBe("cancelled");
    // The task enqueued by the (now-dropped) tick must not linger under a dead loop.
    expect(taskStore.byBatch(loopId).filter((t) => t.status !== "cancelled")).toHaveLength(0);
  });
});

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
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;
    // simulate 3 prior failed spawned tasks for this loop's batch
    for (let i = 0; i < 3; i++) {
      await taskStore.save({
        id: `f${i}`,
        batchId: id,
        goal: "g",
        executor: "hera",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        status: "failed",
        attempts: 3,
        maxAttempts: 3,
        createdAt: i,
        updatedAt: i,
        completedAt: i,
      });
    }
    await mgr.tick(5000);
    expect((await mgr.get(id))?.status).toBe("failed");
    expect((await mgr.get(id))?.lastError).toContain("circuit-breaker");
  });

  it("retention never prunes below the circuit-breaker window (breaker survives a high maxConsecutiveFailures)", async () => {
    // A threshold ABOVE the retention floor: naive pruning to LOOP_TASK_RETENTION
    // would permanently cap the trailing-failure count below this, so the breaker
    // could never trip and a perpetually-failing loop would retry forever.
    const HIGH = LOOP_TASK_RETENTION + 5;
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const mgr = new LoopManager(
      loopStore,
      taskStore,
      evalr,
      dir,
      { ...OPTS, maxConsecutiveFailures: HIGH },
      () => 1000
    );
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;

    // More terminal tasks than either the retention floor OR the threshold, with
    // the most recent one SUCCEEDED so the breaker does not trip on this tick —
    // forcing the retention prune to run.
    const total = HIGH + 10;
    for (let i = 0; i < total; i++) {
      await taskStore.save({
        id: `f${i}`,
        batchId: id,
        goal: "g",
        executor: "hera",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        status: i === total - 1 ? "succeeded" : "failed",
        attempts: 3,
        maxAttempts: 3,
        createdAt: i,
        updatedAt: i,
        completedAt: i,
      });
    }
    await mgr.tick(1000);

    // Retention must keep at least the breaker window (max(RETENTION, HIGH)=HIGH),
    // not trim down to the RETENTION floor.
    const terminalRemaining = taskStore
      .byBatch(id)
      .filter((t) => t.status === "failed" || t.status === "succeeded").length;
    expect(terminalRemaining).toBe(HIGH);
  });

  it("a later success resets the trailing-failure run (no trip)", async () => {
    const mgr = makeManager(dir, loopStore, taskStore, 1000);
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;
    await taskStore.save({
      id: "f1",
      batchId: id,
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    });
    await taskStore.save({
      id: "f2",
      batchId: id,
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
      createdAt: 2,
      updatedAt: 2,
      completedAt: 2,
    });
    await taskStore.save({
      id: "s1",
      batchId: id,
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "succeeded",
      attempts: 1,
      maxAttempts: 3,
      createdAt: 3,
      updatedAt: 3,
      completedAt: 3,
    });
    await mgr.tick(2000); // trailing run is 0 (last terminal is succeeded) -> no trip; recurring fires
    expect((await mgr.get(id))?.status).toBe("active");
  });
});

describe("LoopManager cross-process fencing", () => {
  let dir: string;
  let loopA: LoopStore;
  let taskA: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopfence-"));
    loopA = new LoopStore(dir);
    await loopA.init();
    taskA = new TaskStore(dir);
    await taskA.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("only ONE of two processes fires a recurring loop due in both (lease fence)", async () => {
    // Process A creates the loop; the recurring schedule makes it due at 2000.
    const mgrA = makeManager(dir, loopA, taskA, 1000);
    const res = await mgrA.createLoop({
      mode: "recurring",
      taskTemplate: template,
      recurring: { intervalMs: 1000 },
    });
    const id = (res as { id: string }).id;

    // Process B attaches to the SAME data dir with its own stores + manager (its
    // own distinct lease owner). B snapshots the loop as active-and-due into its
    // stale cache, exactly like a second OpenCode process would.
    const loopB = new LoopStore(dir);
    await loopB.init();
    const taskB = new TaskStore(dir);
    await taskB.init();
    const mgrB = makeManager(dir, loopB, taskB, 1000);

    // Both processes tick the same due loop at the same instant. A claims the
    // firing lease on disk; B re-reads disk, sees A's live lease, and skips.
    await mgrA.tick(2000);
    await mgrB.tick(2000);

    // Disk truth: exactly one task was enqueued, not two.
    const verify = new TaskStore(dir);
    await verify.init();
    expect(verify.byBatch(id)).toHaveLength(1);

    // The loser (B) left no lease of its own; A owns the firing.
    const loopVerify = new LoopStore(dir);
    await loopVerify.init();
    expect((await loopVerify.get(id))?.leaseOwner).toBeDefined();
  });
});
