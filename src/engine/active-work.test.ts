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

const OPTS = {
  tickMs: 10,
  defaultMaxIterations: 25,
  minIntervalMs: 1000,
  maxConsecutiveFailures: 5,
};

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
    loopManager = new LoopManager(
      loopStore,
      taskStore,
      new AcceptanceEvaluator({ shellEnabled: true }),
      dir,
      OPTS,
      () => 1000
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty string when there is no live work", async () => {
    expect(await buildActiveWorkContext(taskStore, loopManager)).toBe("");
  });

  it("summarizes pending/running tasks and active loops", async () => {
    await taskStore.save({
      id: "p1",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
    });
    await loopManager.createLoop({
      mode: "drain",
      taskTemplate: {
        goal: "g",
        executor: "hera",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      },
    });
    const ctx = await buildActiveWorkContext(taskStore, loopManager);
    expect(ctx).toContain("Active durable work");
    expect(ctx).toContain("pending");
    expect(ctx).toContain("loop");
    expect(ctx).toContain("hera_engine_health");
  });
});
