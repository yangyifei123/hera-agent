// src/tools/task-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../engine/task-store.js";
import { createTaskTools } from "./task-tools.js";

function ctxWith(store: TaskStore) {
  return { taskStore: store } as unknown as Parameters<typeof createTaskTools>[0];
}

describe("task-tools", () => {
  let dir: string;
  let store: TaskStore;
  let tools: ReturnType<typeof createTaskTools>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasktools-"));
    store = new TaskStore(dir);
    await store.init();
    tools = createTaskTools(ctxWith(store));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("enqueues a valid task", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "build", acceptance: [{ type: "file_exists", path: "/tmp/z" }] } as any,
      {} as any
    );
    expect(String(res)).toContain("enqueued");
    expect(store.byStatus("pending")).toHaveLength(1);
  });

  it("rejects a task with no acceptance checks", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "build", acceptance: [] } as any,
      {} as any
    );
    expect(String(res)).toContain("acceptance");
    expect(store.byStatus("pending")).toHaveLength(0);
  });

  it("rejects a task with a malformed acceptance check", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "build", acceptance: [{ type: "bogus", foo: 1 }] } as any,
      {} as any
    );
    expect(String(res)).toContain("malformed");
    expect(store.byStatus("pending")).toHaveLength(0);
  });

  it("rejects a regex acceptance check missing its pattern", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "build", acceptance: [{ type: "regex", source: "output" }] } as any,
      {} as any
    );
    expect(String(res)).toContain("malformed");
    expect(store.byStatus("pending")).toHaveLength(0);
  });

  it("rejects a task with an empty goal", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "  ", acceptance: [{ type: "file_exists", path: "/tmp/z" }] } as any,
      {} as any
    );
    expect(String(res)).toContain("goal");
  });

  it("enqueues a batch under one batchId", async () => {
    const res = await tools.hera_enqueue_batch.execute(
      {
        tasks: [
          { goal: "a", acceptance: [{ type: "file_exists", path: "/tmp/a" }] },
          { goal: "b", acceptance: [{ type: "file_exists", path: "/tmp/b" }] },
        ],
      } as any,
      {} as any
    );
    const batchId = String(res).match(/batch ([\w-]+)/)?.[1];
    expect(batchId).toBeTruthy();
    expect(store.byBatch(batchId!)).toHaveLength(2);
  });

  it("reports batch accounting without calling partial success complete", async () => {
    await store.save({
      id: "x",
      batchId: "b9",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "failed",
      attempts: 3,
      maxAttempts: 3,
      lastError: "nope",
      createdAt: 1,
      updatedAt: 1,
    });
    await store.save({
      id: "y",
      batchId: "b9",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/y" }],
      status: "succeeded",
      attempts: 1,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await tools.hera_batch_report.execute({ batchId: "b9" } as any, {} as any);
    expect(String(res)).toContain("1 succeeded");
    expect(String(res)).toContain("1 failed");
    expect(String(res)).toContain("x");
  });
});
