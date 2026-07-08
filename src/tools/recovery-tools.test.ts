// src/tools/recovery-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../engine/task-store.js";
import { createRecoveryTools } from "./recovery-tools.js";

function ctx(
  taskStore: TaskStore,
  supervisor: unknown,
  loopManager: unknown,
  teamManager: unknown
) {
  return { taskStore, supervisor, loopManager, teamManager } as unknown as Parameters<
    typeof createRecoveryTools
  >[0];
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
      id: "orphan",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "running",
      attempts: 1,
      maxAttempts: 3,
      leaseOwner: "dead",
      leaseExpiresAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const tools = createRecoveryTools(
      ctx(
        taskStore,
        {
          // hera_recover now delegates to supervisor.recover() so the reclaim
          // honors activeIds and cascades failed dependencies.
          recover: async () => taskStore.recover(Date.now()),
          stats: () => ({ active: 0, reclaimed: 0, concurrency: 8 }),
        },
        { list: async () => [] },
        {}
      )
    );
    const res = await tools.hera_recover.execute({} as any, {} as any);
    expect(String(res)).toContain("1");
    expect(taskStore.byStatus("pending").map((t) => t.id)).toContain("orphan");
  });

  it("hera_engine_health reports task and supervisor stats", async () => {
    await taskStore.save({
      id: "a",
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "succeeded",
      attempts: 1,
      maxAttempts: 3,
      createdAt: 1,
      updatedAt: 1,
    });
    const tools = createRecoveryTools(
      ctx(
        taskStore,
        { stats: () => ({ active: 2, reclaimed: 3, concurrency: 8 }) },
        { list: async () => [{ id: "l", mode: "drain", status: "active", iterations: 0 }] },
        {}
      )
    );
    const res = await tools.hera_engine_health.execute({} as any, {} as any);
    expect(String(res)).toContain("succeeded");
    expect(String(res)).toContain("reclaimed");
  });

  it("hera_recover_sessions reports the reconciled count", async () => {
    const tools = createRecoveryTools(
      ctx(
        taskStore,
        { stats: () => ({ active: 0, reclaimed: 0, concurrency: 8 }) },
        { list: async () => [] },
        { recoverSessions: async () => 2 }
      )
    );
    const res = await tools.hera_recover_sessions.execute({} as any, {} as any);
    expect(String(res)).toContain("2");
  });
});
