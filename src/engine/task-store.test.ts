// src/engine/task-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import type { TaskRecord } from "./task-types.js";

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  const now = 1000;
  return {
    id: over.id ?? "t1",
    goal: "do a thing",
    executor: "hera",
    acceptance: [{ type: "file_exists", path: "/tmp/x" }],
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("TaskStore", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskstore-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and gets a task", async () => {
    await store.save(makeTask());
    expect((await store.get("t1"))?.goal).toBe("do a thing");
  });

  it("indexes by status and batch", async () => {
    await store.save(makeTask({ id: "a", status: "pending", batchId: "b1" }));
    await store.save(makeTask({ id: "b", status: "running", batchId: "b1" }));
    expect(store.byStatus("pending").map((t) => t.id)).toEqual(["a"]);
    expect(store.byBatch("b1").map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("claimReady leases up to limit and sets running", async () => {
    await store.save(makeTask({ id: "a" }));
    await store.save(makeTask({ id: "b" }));
    await store.save(makeTask({ id: "c" }));
    const claimed = await store.claimReady(2, 5000, "owner-1", 1000);
    expect(claimed).toHaveLength(2);
    for (const t of claimed) {
      expect(t.status).toBe("running");
      expect(t.leaseOwner).toBe("owner-1");
      expect(t.leaseExpiresAt).toBe(6000);
    }
    expect(store.byStatus("pending")).toHaveLength(1);
  });

  it("claimReady skips tasks with unsatisfied dependencies", async () => {
    await store.save(makeTask({ id: "dep", status: "pending" }));
    await store.save(makeTask({ id: "child", status: "pending", dependsOn: ["dep"] }));
    const claimed = await store.claimReady(10, 5000, "o", 1000);
    expect(claimed.map((t) => t.id)).toEqual(["dep"]);
  });

  it("claimReady includes a child once its dependency has succeeded", async () => {
    await store.save(makeTask({ id: "dep", status: "succeeded" }));
    await store.save(makeTask({ id: "child", status: "pending", dependsOn: ["dep"] }));
    const claimed = await store.claimReady(10, 5000, "o", 1000);
    expect(claimed.map((t) => t.id)).toEqual(["child"]);
  });

  it("recover resets running tasks with expired leases to pending", async () => {
    await store.save(makeTask({ id: "a", status: "running", leaseOwner: "old", leaseExpiresAt: 500 }));
    await store.save(makeTask({ id: "b", status: "running", leaseOwner: "live", leaseExpiresAt: 9999 }));
    const count = await store.recover(1000);
    expect(count).toBe(1);
    expect((await store.get("a"))?.status).toBe("pending");
    expect((await store.get("b"))?.status).toBe("running");
  });
});
