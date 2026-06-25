// src/engine/self-healing-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";

describe("self-healing integration", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "heal-int-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("times out a hung task while completing a healthy one", async () => {
    const healthy = join(dir, "ok.txt");
    const runner: AgentRunner = {
      run: (_e, prompt) => {
        if (prompt.includes("hang")) return new Promise<string>(() => {}); // never resolves
        return (async () => {
          await writeFile(healthy, "x");
          return "done";
        })();
      },
    };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir, 40); // 40ms attempt timeout
    const sup = new Supervisor(
      store,
      exec,
      { concurrency: 4, leaseMs: 60000, tickMs: 5, ownerId: "it" },
      () => 1000
    );

    await store.save({
      id: "hung",
      goal: "hang forever",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: join(dir, "never") }],
      status: "pending",
      attempts: 0,
      maxAttempts: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await store.save({
      id: "good",
      goal: "make ok",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: healthy }],
      status: "pending",
      attempts: 0,
      maxAttempts: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    await sup.drain();
    expect(store.byStatus("succeeded").map((t) => t.id)).toContain("good");
    expect(store.byStatus("failed").map((t) => t.id)).toContain("hung");
  }, 20000);
});
