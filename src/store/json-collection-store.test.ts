// src/store/json-collection-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
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
});
