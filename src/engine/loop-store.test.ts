// src/engine/loop-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopStore } from "./loop-store.js";
import type { LoopDefinition } from "./loop-types.js";

function makeLoop(over: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    id: over.id ?? "l1",
    mode: "drain",
    status: "active",
    taskTemplate: { goal: "g", executor: "hera", acceptance: [{ type: "file_exists", path: "/tmp/x" }] },
    iterations: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe("LoopStore", () => {
  let dir: string;
  let store: LoopStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopstore-"));
    store = new LoopStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and gets a loop", async () => {
    await store.save(makeLoop());
    expect((await store.get("l1"))?.mode).toBe("drain");
  });

  it("indexes by status and mode", async () => {
    await store.save(makeLoop({ id: "a", status: "active", mode: "watch" }));
    await store.save(makeLoop({ id: "b", status: "paused", mode: "watch" }));
    await store.save(makeLoop({ id: "c", status: "active", mode: "recurring" }));
    expect(store.byStatus("active").map((l) => l.id).sort()).toEqual(["a", "c"]);
    expect(store.byMode("watch").map((l) => l.id).sort()).toEqual(["a", "b"]);
  });

  it("reflects status changes in the index after overwrite", async () => {
    await store.save(makeLoop({ id: "a", status: "active" }));
    await store.save(makeLoop({ id: "a", status: "completed" }));
    expect(store.byStatus("active")).toHaveLength(0);
    expect(store.byStatus("completed").map((l) => l.id)).toEqual(["a"]);
  });
});
