// src/engine/executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import type { TaskRecord } from "./task-types.js";

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "t1",
    goal: "g",
    executor: "hera",
    acceptance: [{ type: "file_exists", path: "/tmp/x" }],
    status: "running",
    attempts: 0,
    maxAttempts: 2,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe("TaskExecutor", () => {
  let dir: string;
  let store: TaskStore;
  let evalr: AcceptanceEvaluator;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "exec-"));
    store = new TaskStore(dir);
    await store.init();
    evalr = new AcceptanceEvaluator({ shellEnabled: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("marks a task succeeded when acceptance passes, recording proof", async () => {
    const target = join(dir, "out.txt");
    const runner: AgentRunner = {
      run: async () => {
        await writeFile(target, "ok");
        return "wrote it";
      },
    };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: target }] });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("succeeded");
    expect(updated.proof?.every((p) => p.passed)).toBe(true);
    expect(updated.completedAt).toBe(1000);
  });

  it("retries (pending) when acceptance fails under budget", async () => {
    const runner: AgentRunner = { run: async () => "did nothing" };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({
      acceptance: [{ type: "file_exists", path: join(dir, "missing") }],
      attempts: 0,
      maxAttempts: 2,
    });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("pending");
    expect(updated.attempts).toBe(1);
    expect(updated.leaseOwner).toBeUndefined();
  });

  it("marks failed when the retry budget is exhausted", async () => {
    const runner: AgentRunner = { run: async () => "nope" };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({
      acceptance: [{ type: "file_exists", path: join(dir, "missing") }],
      attempts: 1,
      maxAttempts: 2,
    });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.attempts).toBe(2);
  });

  it("treats an agent error as a failed attempt", async () => {
    const runner: AgentRunner = {
      run: async () => {
        throw new Error("agent boom");
      },
    };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ attempts: 1, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.lastError).toContain("agent boom");
  });

  it("records the agent output on a succeeded task", async () => {
    const target = join(dir, "out.txt");
    const runner: AgentRunner = {
      run: async () => {
        await writeFile(target, "ok");
        return "AGENT_SAID_THIS";
      },
    };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: target }] });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("succeeded");
    expect(updated.output).toBe("AGENT_SAID_THIS");
  });

  it("records the agent output on a retry (acceptance failed)", async () => {
    const runner: AgentRunner = { run: async () => "PARTIAL_WORK" };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({
      acceptance: [{ type: "file_exists", path: join(dir, "missing") }],
      attempts: 0,
      maxAttempts: 2,
    });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("pending");
    expect(updated.output).toBe("PARTIAL_WORK");
  });

  it("leaves output undefined on agent error", async () => {
    const runner: AgentRunner = {
      run: async () => {
        throw new Error("boom");
      },
    };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ attempts: 1, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.output).toBeUndefined();
  });

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
    const runner: AgentRunner = {
      run: async () => {
        await writeFile(target, "x");
        return "ok";
      },
    };
    const exec = new TaskExecutor(store, evalr, runner, dir, 5000);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: target }] });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("succeeded");
  });
});
