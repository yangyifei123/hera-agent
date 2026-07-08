// src/tools/loop-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../engine/task-store.js";
import { LoopStore } from "../engine/loop-store.js";
import { LoopManager } from "../engine/loop-manager.js";
import { AcceptanceEvaluator } from "../engine/acceptance.js";
import { createLoopTools } from "./loop-tools.js";

function ctxWith(loopManager: LoopManager) {
  return { loopManager } as unknown as Parameters<typeof createLoopTools>[0];
}

describe("loop-tools", () => {
  let dir: string;
  let mgr: LoopManager;
  let tools: ReturnType<typeof createLoopTools>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "looptools-"));
    const loopStore = new LoopStore(dir);
    await loopStore.init();
    const taskStore = new TaskStore(dir);
    await taskStore.init();
    mgr = new LoopManager(
      loopStore,
      taskStore,
      new AcceptanceEvaluator({ shellEnabled: true }),
      dir,
      { tickMs: 10, defaultMaxIterations: 25, minIntervalMs: 1000, maxConsecutiveFailures: 5 },
      () => 1000
    );
    tools = createLoopTools(ctxWith(mgr));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a recurring loop", async () => {
    const res = await tools.hera_create_loop.execute(
      {
        mode: "recurring",
        goal: "ping",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        intervalMs: 5000,
      } as any,
      {} as any
    );
    expect(String(res)).toContain("created");
    expect(await mgr.list("active")).toHaveLength(1);
  });

  it("rejects a loop with no acceptance", async () => {
    const res = await tools.hera_create_loop.execute(
      { mode: "drain", goal: "g", acceptance: [] } as any,
      {} as any
    );
    expect(String(res)).toContain("acceptance");
  });

  it("rejects a loop with a malformed acceptance check (same contract as enqueue)", async () => {
    const res = await tools.hera_create_loop.execute(
      {
        mode: "iterate",
        goal: "g",
        acceptance: [{ type: "bogus", foo: 1 }],
        maxIterations: 2,
      } as any,
      {} as any
    );
    expect(String(res)).toContain("Error");
    expect(String(res)).toContain("malformed");
    expect(await mgr.list("active")).toHaveLength(0);
  });

  it("rejects a watch loop whose condition reads output (never satisfiable)", async () => {
    const res = await tools.hera_create_loop.execute(
      {
        mode: "watch",
        goal: "g",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        condition: [{ type: "regex", source: "output", pattern: "DONE" }],
      } as any,
      {} as any
    );
    expect(String(res)).toContain("Error");
    expect(String(res)).toContain("never match");
    expect(await mgr.list("active")).toHaveLength(0);
  });

  it("rejects a watch loop with a malformed condition", async () => {
    const res = await tools.hera_create_loop.execute(
      {
        mode: "watch",
        goal: "g",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        condition: [{ type: "bogus" }],
      } as any,
      {} as any
    );
    expect(String(res)).toContain("Error");
    expect(await mgr.list("active")).toHaveLength(0);
  });

  it("rejects an iterate loop with a malformed iterateGoal", async () => {
    const res = await tools.hera_create_loop.execute(
      {
        mode: "iterate",
        goal: "g",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        iterateGoal: [{ type: "regex", source: "file" }],
        maxIterations: 3,
      } as any,
      {} as any
    );
    expect(String(res)).toContain("iterateGoal");
    expect(await mgr.list("active")).toHaveLength(0);
  });

  it("accepts a watch loop with a valid file_exists condition", async () => {
    const res = await tools.hera_create_loop.execute(
      {
        mode: "watch",
        goal: "g",
        acceptance: [{ type: "file_exists", path: "/tmp/x" }],
        condition: [{ type: "file_exists", path: "/tmp/trigger" }],
      } as any,
      {} as any
    );
    expect(String(res)).toContain("created");
    expect(await mgr.list("active")).toHaveLength(1);
  });

  it("rejects hera_list_loops with an invalid status", async () => {
    const res = await tools.hera_list_loops.execute({ status: "bogus" } as any, {} as any);
    expect(String(res)).toContain("invalid status");
    expect(String(res)).toContain("Expected one of");
  });

  it("lists, pauses, resumes, and cancels", async () => {
    const created = await tools.hera_create_loop.execute(
      { mode: "drain", goal: "g", acceptance: [{ type: "file_exists", path: "/tmp/x" }] } as any,
      {} as any
    );
    const id = String(created).match(/loop ([\w-]+)/)?.[1]!;
    expect(String(await tools.hera_list_loops.execute({} as any, {} as any))).toContain(id);
    expect(String(await tools.hera_pause_loop.execute({ id } as any, {} as any))).toContain(
      "paused"
    );
    expect(String(await tools.hera_resume_loop.execute({ id } as any, {} as any))).toContain(
      "resumed"
    );
    expect(String(await tools.hera_cancel_loop.execute({ id } as any, {} as any))).toContain(
      "cancelled"
    );
    expect(String(await tools.hera_loop_status.execute({ id } as any, {} as any))).toContain(
      "cancelled"
    );
  });
});
