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
    taskTemplate: {
      goal: "g",
      executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
    },
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
    expect(
      store
        .byStatus("active")
        .map((l) => l.id)
        .sort()
    ).toEqual(["a", "c"]);
    expect(
      store
        .byMode("watch")
        .map((l) => l.id)
        .sort()
    ).toEqual(["a", "b"]);
  });

  it("reflects status changes in the index after overwrite", async () => {
    await store.save(makeLoop({ id: "a", status: "active" }));
    await store.save(makeLoop({ id: "a", status: "completed" }));
    expect(store.byStatus("active")).toHaveLength(0);
    expect(store.byStatus("completed").map((l) => l.id)).toEqual(["a"]);
  });

  it("updateFromDisk reads the authoritative on-disk record, not a stale cache", async () => {
    // Two LoopStores over the SAME dir model two OpenCode processes. Process A
    // stamps a firing lease on disk; process B's cache is stale (no lease), but
    // its disk-authoritative CAS must observe the lease A just wrote.
    await store.save(makeLoop({ id: "shared", status: "active" }));
    const other = new LoopStore(dir);
    await other.init(); // B snapshots "shared" (unleased) into its cache

    const leased = await store.updateFromDisk("shared", (cur) =>
      cur ? { ...cur, leaseOwner: "A", leaseExpiresAt: 9999 } : undefined
    );
    expect(leased?.leaseOwner).toBe("A");

    // B's cache still shows no lease, but updateFromDisk must re-read disk.
    let seenOwner: string | undefined = "unset";
    await other.updateFromDisk("shared", (cur) => {
      seenOwner = cur?.leaseOwner;
      return undefined; // abort — we only assert what the CAS observed
    });
    expect(seenOwner).toBe("A");
  });
});
