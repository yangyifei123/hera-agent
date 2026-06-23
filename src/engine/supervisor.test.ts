// src/engine/supervisor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";
import type { TaskRecord } from "./task-types.js";

function makeTask(id: string, target: string): TaskRecord {
  return {
    id,
    goal: "make file",
    executor: "hera",
    acceptance: [{ type: "file_exists", path: target }],
    status: "pending",
    attempts: 0,
    maxAttempts: 2,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("Supervisor", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sup-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildSupervisor(runner: AgentRunner, concurrency = 4) {
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir);
    return new Supervisor(
      store,
      exec,
      { concurrency, leaseMs: 5000, tickMs: 10, ownerId: "sup-1" },
      () => 1000
    );
  }

  it("drains a batch of tasks to completion", async () => {
    const runner: AgentRunner = {
      run: async (_e, prompt) => {
        const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
        if (m) await writeFile(m[1], "x");
        return "done";
      },
    };
    const sup = buildSupervisor(runner, 4);
    for (let i = 0; i < 20; i++) {
      await store.save(makeTask(`t${i}`, join(dir, `f${i}.txt`)));
    }
    await sup.drain();
    expect(store.byStatus("succeeded")).toHaveLength(20);
    expect(store.byStatus("pending")).toHaveLength(0);
  });

  it("never exceeds the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const runner: AgentRunner = {
      run: async (_e, prompt) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
        if (m) await writeFile(m[1], "x");
        active--;
        return "done";
      },
    };
    const sup = buildSupervisor(runner, 3);
    for (let i = 0; i < 12; i++) await store.save(makeTask(`t${i}`, join(dir, `f${i}.txt`)));
    await sup.drain();
    expect(peak).toBeLessThanOrEqual(3);
    expect(store.byStatus("succeeded")).toHaveLength(12);
  });

  it("overlapping dispatchOnce calls do not exceed the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const runner: AgentRunner = {
      run: async (_e, prompt) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
        if (m) await writeFile(m[1], "x");
        active--;
        return "done";
      },
    };
    const sup = buildSupervisor(runner, 3);
    for (let i = 0; i < 12; i++) await store.save(makeTask(`t${i}`, join(dir, `f${i}.txt`)));
    // Fire overlapping dispatches to trigger the race — without the guard these
    // would each observe the same stale active.size and over-claim up to 3×concurrency.
    await Promise.all([sup.dispatchOnce(), sup.dispatchOnce(), sup.dispatchOnce()]);
    await sup.drain();
    expect(peak).toBeLessThanOrEqual(3);
    expect(store.byStatus("succeeded")).toHaveLength(12);
  });

  it("recover resets crashed running tasks", async () => {
    const t = makeTask("crashed", join(dir, "c.txt"));
    await store.save({ ...t, status: "running", leaseOwner: "old", leaseExpiresAt: 1 });
    const sup = buildSupervisor({ run: async () => "noop" });
    const recovered = await sup.recover();
    expect(recovered).toBe(1);
    expect((await store.get("crashed"))?.status).toBe("pending");
  });
});
