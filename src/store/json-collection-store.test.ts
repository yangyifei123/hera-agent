// src/store/json-collection-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonCollectionStore, assertSafeId } from "./json-collection-store.js";

interface Row {
  id: string;
  status: string;
  value: number;
}

describe("JsonCollectionStore", () => {
  let dir: string;
  let store: JsonCollectionStore<Row>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jcs-test-"));
    store = new JsonCollectionStore<Row>(dir, "rows", {
      secondaryIndexes: { status: (r) => r.status },
    });
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and loads entries", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    expect(await store.load("a")).toEqual({ id: "a", status: "pending", value: 1 });
  });

  it("lists from the in-memory index", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    await store.save({ id: "b", status: "done", value: 2 });
    const ids = (await store.list()).map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("queries a secondary index", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    await store.save({ id: "b", status: "pending", value: 2 });
    await store.save({ id: "c", status: "done", value: 3 });
    expect(
      store
        .byIndex("status", "pending")
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "b"]);
    expect(store.byIndex("status", "done").map((r) => r.id)).toEqual(["c"]);
  });

  it("updates the secondary index on overwrite", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    await store.save({ id: "a", status: "done", value: 1 });
    expect(store.byIndex("status", "pending")).toHaveLength(0);
    expect(store.byIndex("status", "done").map((r) => r.id)).toEqual(["a"]);
  });

  it("deletes entries and their index membership", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    expect(await store.delete("a")).toBe(true);
    expect(await store.load("a")).toBeNull();
    expect(store.byIndex("status", "pending")).toHaveLength(0);
  });

  it("builds the index from existing files on init", async () => {
    await writeFile(
      join(dir, "rows", "x.json"),
      JSON.stringify({ id: "x", status: "pending", value: 9 })
    );
    const fresh = new JsonCollectionStore<Row>(dir, "rows", {
      secondaryIndexes: { status: (r) => r.status },
    });
    await fresh.init();
    expect(fresh.byIndex("status", "pending").map((r) => r.id)).toEqual(["x"]);
  });

  it("skips corrupt files on init", async () => {
    await mkdir(join(dir, "rows"), { recursive: true });
    await writeFile(join(dir, "rows", "bad.json"), "{not json");
    const fresh = new JsonCollectionStore<Row>(dir, "rows");
    await fresh.init();
    expect(fresh.size()).toBe(0);
  });

  it("rejects unsafe ids", async () => {
    expect(() => assertSafeId("../escape")).toThrow();
    await expect(store.save({ id: "a/b", status: "x", value: 1 })).rejects.toThrow();
  });

  it("serializes concurrent saves of the same id so memory matches the last write", async () => {
    // Both fired without awaiting; the second-queued save completes last and wins.
    const first = store.save({ id: "k", status: "first", value: 1 });
    const second = store.save({ id: "k", status: "second", value: 2 });
    await Promise.all([first, second]);

    const winner = { id: "k", status: "second", value: 2 };
    expect(await store.load("k")).toEqual(winner);
    const onDisk = JSON.parse(await readFile(join(dir, "rows", "k.json"), "utf-8"));
    expect(onDisk).toEqual(winner);
    expect(store.byIndex("status", "first")).toHaveLength(0);
    expect(store.byIndex("status", "second").map((r) => r.id)).toEqual(["k"]);
    expect(store.size()).toBe(1);
  });

  it("runs concurrent saves of different ids without dropping either", async () => {
    await Promise.all([
      store.save({ id: "x", status: "pending", value: 1 }),
      store.save({ id: "y", status: "pending", value: 2 }),
    ]);
    expect(await store.load("x")).toEqual({ id: "x", status: "pending", value: 1 });
    expect(await store.load("y")).toEqual({ id: "y", status: "pending", value: 2 });
    expect(
      store
        .byIndex("status", "pending")
        .map((r) => r.id)
        .sort()
    ).toEqual(["x", "y"]);
  });

  it("update() reads the latest value and persists the mutation", async () => {
    await store.save({ id: "u", status: "pending", value: 1 });
    const next = await store.update("u", (cur) =>
      cur ? { ...cur, status: "running", value: cur.value + 1 } : null
    );
    expect(next).toEqual({ id: "u", status: "running", value: 2 });
    expect(await store.load("u")).toEqual({ id: "u", status: "running", value: 2 });
    expect(store.byIndex("status", "pending")).toHaveLength(0);
    expect(store.byIndex("status", "running").map((r) => r.id)).toEqual(["u"]);
  });

  it("update() aborts the write when the mutator returns null", async () => {
    await store.save({ id: "u", status: "pending", value: 1 });
    const result = await store.update("u", () => null);
    expect(result).toEqual({ id: "u", status: "pending", value: 1 });
    expect(await store.load("u")).toEqual({ id: "u", status: "pending", value: 1 });
  });

  it("update() serializes against a concurrent save so it cannot resurrect stale state", async () => {
    // The canonical bug: a long-running holder captured a stale snapshot and,
    // after an intervening terminal write, blindly persists it. update() closes
    // the read+write in one lock, so the terminal write is observed and honored.
    await store.save({ id: "t", status: "running", value: 0 });

    // A "cancel" lands first...
    const cancel = store.save({ id: "t", status: "cancelled", value: 0 });
    // ...then a stale executor tries to mark it succeeded, but guards on the
    // freshly-read status.
    const finish = store.update("t", (cur) =>
      cur && cur.status === "cancelled" ? null : { id: "t", status: "succeeded", value: 1 }
    );
    await Promise.all([cancel, finish]);

    expect(await store.load("t")).toEqual({ id: "t", status: "cancelled", value: 0 });
    expect(store.byIndex("status", "succeeded")).toHaveLength(0);
  });

  it("refreshFromDisk surfaces externally written files without re-init", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    // Another writer (e.g. a generated plugin's inlined hera_remember) drops a
    // memo file straight into the collection dir, bypassing the store API.
    await writeFile(
      join(dir, "rows", "ext.json"),
      JSON.stringify({ id: "ext", status: "pending", value: 7 })
    );
    // Not visible to the cached list yet.
    expect((await store.list()).map((r) => r.id).sort()).toEqual(["a"]);
    await store.refreshFromDisk();
    expect((await store.list()).map((r) => r.id).sort()).toEqual(["a", "ext"]);
    // Secondary index picks it up too.
    expect(
      store
        .byIndex("status", "pending")
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "ext"]);
  });

  it("refreshFromDisk does not re-read files already cached", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    // Mutate the backing file directly. A cheap refresh must only readFile NEW
    // ids, so this unchanged-id's file is never re-read and the cache is kept.
    await writeFile(
      join(dir, "rows", "a.json"),
      JSON.stringify({ id: "a", status: "changed", value: 99 })
    );
    await store.refreshFromDisk();
    expect(await store.load("a")).toEqual({ id: "a", status: "pending", value: 1 });
  });

  it("refreshFromDisk drops entries whose file disappeared", async () => {
    await store.save({ id: "a", status: "pending", value: 1 });
    await rm(join(dir, "rows", "a.json"));
    await store.refreshFromDisk();
    expect(await store.load("a")).toBeNull();
    expect(store.byIndex("status", "pending")).toHaveLength(0);
    expect(store.size()).toBe(0);
  });

  it("update() reads a cold entry from disk when not cached", async () => {
    // Simulate a record written by another process (present on disk, absent
    // from this store's cache).
    const fresh = new JsonCollectionStore<Row>(dir, "rows", {
      secondaryIndexes: { status: (r) => r.status },
    });
    await fresh.init();
    await store.save({ id: "cold", status: "pending", value: 5 });
    const updated = await fresh.update("cold", (cur) => (cur ? { ...cur, status: "seen" } : null));
    expect(updated).toEqual({ id: "cold", status: "seen", value: 5 });
  });
});
