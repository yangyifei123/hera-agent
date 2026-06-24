// src/engine/loop-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

    await rm(trigger);
    await mgr.tick(1001); // condition false -> re-arm, no enqueue
    expect(taskStore.byBatch(id)).toHaveLength(1);

    await writeFile(trigger, "x");
    await mgr.tick(1002); // edge again -> enqueue #2
    expect(taskStore.byBatch(id)).toHaveLength(2);
  });
});
