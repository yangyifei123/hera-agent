// src/engine/index.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "./index.js";
import { TaskStore } from "./task-store.js";

describe("createEngine init latch", () => {
  test("retries init() after a transient failure instead of replaying the stale rejection", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hera-engine-latch-"));
    try {
      const engine = createEngine({ dataDir, cwd: dataDir, client: undefined });

      // Force the first TaskStore.init() to throw, then succeed thereafter.
      const realInit = TaskStore.prototype.init;
      let calls = 0;
      (TaskStore.prototype as { init: () => Promise<void> }).init = async function (
        this: TaskStore
      ) {
        calls += 1;
        if (calls === 1) throw new Error("transient fs failure");
        return realInit.call(this);
      };

      try {
        await expect(engine.init()).rejects.toThrow("transient fs failure");
        // A rejected latch must NOT be cached: a second call retries and succeeds.
        await engine.init();
        expect(calls).toBeGreaterThanOrEqual(2);
      } finally {
        (TaskStore.prototype as { init: typeof realInit }).init = realInit;
      }

      engine.stop();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
