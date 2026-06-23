// src/engine/engine-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";
import type { TaskRecord } from "./task-types.js";

describe("HDTE integration", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hdte-int-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("drains 500 tasks to genuine completion with proof", async () => {
    const runner: AgentRunner = {
      run: async (_e, prompt) => {
        const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
        if (m) await writeFile(m[1], "ok");
        return "done";
      },
    };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const sup = new Supervisor(
      store,
      exec,
      { concurrency: 16, leaseMs: 60000, tickMs: 5, ownerId: "it" },
      () => 1000
    );

    for (let i = 0; i < 500; i++) {
      const target = join(dir, `out-${i}.txt`);
      const task: TaskRecord = {
        id: `task-${i}`,
        batchId: "big",
        goal: "make file",
        executor: "hera",
        acceptance: [{ type: "file_exists", path: target }],
        status: "pending",
        attempts: 0,
        maxAttempts: 2,
        createdAt: i,
        updatedAt: i,
      };
      await store.save(task);
    }

    await sup.drain();

    expect(store.byStatus("succeeded")).toHaveLength(500);
    expect(store.byStatus("pending")).toHaveLength(0);
    expect(store.byStatus("failed")).toHaveLength(0);
    // every task recorded passing proof
    for (const t of store.byBatch("big")) {
      expect(t.proof?.every((p) => p.passed)).toBe(true);
    }
    await access(join(dir, "out-499.txt")); // throws if missing
  }, 60000);

  it("surfaces a permanently failing task as failed, never as success", async () => {
    const runner: AgentRunner = { run: async () => "did nothing" };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const sup = new Supervisor(
      store,
      exec,
      { concurrency: 4, leaseMs: 60000, tickMs: 5, ownerId: "it" },
      () => 1000
    );
    await store.save({
      id: "doomed",
      batchId: "b",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: join(dir, "never") }],
      status: "pending",
      attempts: 0,
      maxAttempts: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    await sup.drain();
    expect(store.byStatus("failed").map((t) => t.id)).toEqual(["doomed"]);
    expect(store.byStatus("succeeded")).toHaveLength(0);
  }, 20000);
});
