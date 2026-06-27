// src/engine/create-engine.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "./index.js";

describe("createEngine", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "createengine-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("wires a complete engine with task/loop/recovery tools", async () => {
    const engine = createEngine({ dataDir: dir, cwd: dir, client: undefined });
    await engine.init();
    const names = Object.keys(engine.tools);
    expect(names).toContain("hera_enqueue_task");
    expect(names).toContain("hera_create_loop");
    expect(names).toContain("hera_recover");
    expect(names).toContain("hera_engine_health");
    expect(typeof engine.recover).toBe("function");
    expect(typeof engine.start).toBe("function");
    expect(typeof engine.stop).toBe("function");
  });

  it("runs a task end-to-end through the factory", async () => {
    // a stub runner that writes the acceptance file: inject via the engine's executor?
    // Instead, drive the supervisor with a custom runner by constructing through createEngine
    // is not possible (runner is internal). So enqueue a task whose acceptance is a file we create,
    // then mark it succeeded by writing the file and draining with a no-op client runner that fails ->
    // To keep this deterministic, assert the enqueue tool persists a pending task and the supervisor drains it to failed (no client => agent error).
    const engine = createEngine({ dataDir: dir, cwd: dir, client: undefined });
    await engine.init();
    const res = await (
      engine.tools.hera_enqueue_task as { execute: (a: unknown, c: unknown) => Promise<string> }
    ).execute(
      {
        goal: "do",
        acceptance: [{ type: "file_exists", path: join(dir, "never.txt") }],
        maxAttempts: 1,
      },
      {}
    );
    expect(String(res)).toContain("enqueued");
    expect(engine.taskStore.byStatus("pending").length).toBe(1);
    await engine.supervisor.drain(); // no client -> agent error -> failed
    expect(engine.taskStore.byStatus("failed").length).toBe(1);
  });
});
