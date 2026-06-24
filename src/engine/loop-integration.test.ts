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
    const n = 0;
    const runner: AgentRunner = {
      run: async (_e, prompt) => {
        const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
        if (m) await writeFile(m[1], "x");
        return "done";
      },
    };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(taskStore, evalr, runner, dir);
    const sup = new Supervisor(
      taskStore,
      exec,
      { concurrency: 4, leaseMs: 60000, tickMs: 5, ownerId: "it" },
      () => 1000
    );
    const mgr = new LoopManager(
      loopStore,
      taskStore,
      evalr,
      dir,
      { tickMs: 5, defaultMaxIterations: 25, minIntervalMs: 1000 },
      () => 1000
    );

    // recurring loop, interval 1000, each task writes a unique file
    const res = await mgr.createLoop({
      mode: "recurring",
      taskTemplate: {
        goal: "make file",
        executor: "hera",
        acceptance: [{ type: "file_exists", path: join(dir, "f.txt") }],
      },
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
    const runner: AgentRunner = {
      run: async () => {
        attempts++;
        if (attempts >= 2) await writeFile(target, "ok"); // succeeds on 2nd iteration
        return `attempt ${attempts}`;
      },
    };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(taskStore, evalr, runner, dir);
    const sup = new Supervisor(
      taskStore,
      exec,
      { concurrency: 1, leaseMs: 60000, tickMs: 5, ownerId: "it" },
      () => 1000
    );
    const mgr = new LoopManager(
      loopStore,
      taskStore,
      evalr,
      dir,
      { tickMs: 5, defaultMaxIterations: 5, minIntervalMs: 1000 },
      () => 1000
    );

    const res = await mgr.createLoop({
      mode: "iterate",
      taskTemplate: {
        goal: "make done.txt",
        executor: "hera",
        acceptance: [{ type: "file_exists", path: target }],
        maxAttempts: 1,
      },
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
