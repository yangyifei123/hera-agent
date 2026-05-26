import { describe, test, expect, beforeEach } from "bun:test";
import { MemoryStore } from "./store.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";

const TEST_DIR = join(tmpdir(), "hera-store-test");

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new MemoryStore(TEST_DIR);
    await store.init();
  });

  test("search matches substring by default", async () => {
    await store.save({
      id: "m1",
      type: "session",
      content: "The quick brown fox",
      timestamp: 1000,
    });
    const results = await store.search("quick");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("m1");
  });

  test("search matches word boundaries", async () => {
    await store.save({
      id: "m1",
      type: "session",
      content: "TypeScript is great",
      timestamp: 1000,
    });
    await store.save({
      id: "m2",
      type: "session",
      content: "JavaScript typing is different",
      timestamp: 1001,
    });

    const results = await store.search("Type");
    // "TypeScript" matches word boundary + substring; "typing" has "typ" not "type"
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("m1");
  });

  test("search with since filters by timestamp", async () => {
    await store.save({ id: "old", type: "session", content: "old memory", timestamp: 1000 });
    await store.save({ id: "new", type: "session", content: "new memory", timestamp: 5000 });

    const results = await store.search("memory", undefined, { since: 3000 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("new");
  });

  test("search with since=0 returns all", async () => {
    await store.save({ id: "m1", type: "session", content: "alpha", timestamp: 1000 });
    await store.save({ id: "m2", type: "session", content: "beta", timestamp: 2000 });

    const results = await store.search("", undefined, { since: 0 });
    expect(results).toHaveLength(2);
  });

  test("search with limit truncates results", async () => {
    await store.save({ id: "m1", type: "session", content: "test one", timestamp: 1000 });
    await store.save({ id: "m2", type: "session", content: "test two", timestamp: 1001 });
    await store.save({ id: "m3", type: "session", content: "test three", timestamp: 1002 });

    const results = await store.search("test", undefined, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  test("search with both since and limit", async () => {
    await store.save({ id: "m1", type: "session", content: "match alpha", timestamp: 1000 });
    await store.save({ id: "m2", type: "session", content: "match beta", timestamp: 2000 });
    await store.save({ id: "m3", type: "session", content: "match gamma", timestamp: 3000 });
    await store.save({ id: "m4", type: "session", content: "match delta", timestamp: 4000 });

    const results = await store.search("match", undefined, { since: 2000, limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].timestamp).toBeGreaterThanOrEqual(2000);
  });

  test("search filters by type", async () => {
    await store.save({ id: "s1", type: "session", content: "session data", timestamp: 1000 });
    await store.save({ id: "a1", type: "agent", content: "agent data", timestamp: 1001 });

    const results = await store.search("data", "session");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("session");
  });

  test("search with special regex characters in query", async () => {
    await store.save({ id: "m1", type: "session", content: "file.ts is here", timestamp: 1000 });
    // Should not throw on regex-special chars
    const results = await store.search("file.ts");
    expect(results).toHaveLength(1);
  });

  test("search returns empty for no matches", async () => {
    await store.save({ id: "m1", type: "session", content: "hello world", timestamp: 1000 });
    const results = await store.search("zzznotfound");
    expect(results).toHaveLength(0);
  });

  test("rejects unsafe memory ids", async () => {
    await expect(
      store.save({ id: "../escape", type: "session", content: "bad", timestamp: 1000 })
    ).rejects.toThrow("path traversal");
    await expect(store.load("session", "nested/path")).rejects.toThrow("path traversal");
  });

  test("enforces per-type memory limit by deleting oldest entries", async () => {
    store = new MemoryStore(TEST_DIR, { maxEntries: 2 });
    await store.init();
    await store.save({ id: "old", type: "session", content: "old", timestamp: 1000 });
    await store.save({ id: "middle", type: "session", content: "middle", timestamp: 2000 });
    await store.save({ id: "new", type: "session", content: "new", timestamp: 3000 });

    const ids = (await store.list("session")).map((memory) => memory.id);
    expect(ids).toEqual(["new", "middle"]);
    expect(await store.load("session", "old")).toBeNull();
  });

  test("cleans up expired memories during list and load", async () => {
    await store.save({
      id: "expired",
      type: "session",
      content: "old",
      timestamp: 1000,
      expiresAt: 1,
    });
    await store.save({ id: "active", type: "session", content: "new", timestamp: Date.now() });

    expect(await store.load("session", "expired")).toBeNull();
    const ids = (await store.list("session")).map((memory) => memory.id);
    expect(ids).toEqual(["active"]);
  });

  test("concurrent saves to the same id leave valid JSON", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.save({
          id: "concurrent",
          type: "session",
          content: `value-${index}`,
          timestamp: 1000 + index,
        })
      )
    );

    const loaded = await store.load("session", "concurrent");
    expect(loaded).not.toBeNull();
    expect(loaded!.content).toStartWith("value-");
    const listed = await store.list("session");
    expect(listed).toHaveLength(1);
  });
});
