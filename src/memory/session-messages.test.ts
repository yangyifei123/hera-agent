import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { DistillationEngine } from "../distillation/engine.js";
import {
  fetchSessionMessages,
  saveAutoMemories,
  autoMemoryId,
  type SessionMessagesClient,
} from "./session-messages.js";

/** Build a mock OpenCode client whose session.messages returns the given raw data. */
function mockClient(data: unknown[]): SessionMessagesClient {
  return {
    session: {
      messages: async (_args: { path: { id: string } }) => ({ data }),
    },
  };
}

function rawMsg(role: string, ...texts: string[]) {
  return { info: { role }, parts: texts.map((t) => ({ text: t })) };
}

describe("fetchSessionMessages", () => {
  it("returns [] when there is no client", async () => {
    expect(await fetchSessionMessages(undefined, "s1")).toEqual([]);
  });

  it("returns [] when there is no sessionID", async () => {
    expect(await fetchSessionMessages(mockClient([]), undefined)).toEqual([]);
    expect(await fetchSessionMessages(mockClient([]), "")).toEqual([]);
  });

  it("returns [] when the client has no session.messages method", async () => {
    expect(await fetchSessionMessages({ session: {} }, "s1")).toEqual([]);
  });

  it("maps role + concatenated text parts from the client response", async () => {
    const client = mockClient([
      rawMsg("user", "hello "),
      rawMsg("assistant", "we decided to ", "use PostgreSQL"),
    ]);
    const msgs = await fetchSessionMessages(client, "s1");
    expect(msgs).toEqual([
      { role: "user", content: "hello " },
      { role: "assistant", content: "we decided to use PostgreSQL" },
    ]);
  });

  it("filters out messages with no parts or a non-string role", async () => {
    const client = mockClient([
      rawMsg("assistant", "kept"),
      { info: { role: "assistant" }, parts: [] }, // no parts
      { info: {}, parts: [{ text: "no role" }] }, // no role
    ]);
    const msgs = await fetchSessionMessages(client, "s1");
    expect(msgs).toEqual([{ role: "assistant", content: "kept" }]);
  });

  it("returns [] (does not throw) when the client call rejects", async () => {
    const client: SessionMessagesClient = {
      session: {
        messages: async () => {
          throw new Error("server down");
        },
      },
    };
    expect(await fetchSessionMessages(client, "s1")).toEqual([]);
  });
});

describe("saveAutoMemories", () => {
  let dir: string;
  let store: MemoryStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sessmsg-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 0 and saves nothing for empty messages", async () => {
    expect(await saveAutoMemories(store, [])).toBe(0);
    expect(await store.list()).toHaveLength(0);
  });

  it("extracts and persists a decision under a deterministic auto- id", async () => {
    const saved = await saveAutoMemories(store, [
      { role: "assistant", content: "We decided to use PostgreSQL for storage." },
    ]);
    expect(saved).toBeGreaterThanOrEqual(1);
    const decisions = await store.list("decision");
    expect(decisions.length).toBe(1);
    expect(decisions[0].id).toBe(autoMemoryId("decision", decisions[0].content));
    expect(decisions[0].metadata?.source).toBe("auto-memory");
  });

  it("does NOT accumulate duplicates when the same content is re-extracted", async () => {
    const msgs = [{ role: "assistant", content: "We decided to use PostgreSQL for storage." }];
    await saveAutoMemories(store, msgs);
    await saveAutoMemories(store, msgs); // simulate the next compaction's overlapping window
    await saveAutoMemories(store, msgs);
    expect(await store.list("decision")).toHaveLength(1);
  });

  it("captures distinct categories from a mixed session", async () => {
    await saveAutoMemories(store, [
      { role: "assistant", content: "We decided to use a message queue." },
      { role: "assistant", content: "Fixed the race condition in the supervisor." },
      { role: "assistant", content: "Always use prepared statements for queries." },
    ]);
    expect((await store.list("decision")).length).toBeGreaterThanOrEqual(1);
    expect((await store.list("fix")).length).toBeGreaterThanOrEqual(1);
    expect((await store.list("pattern")).length).toBeGreaterThanOrEqual(1);
  });
});

describe("stress", () => {
  let dir: string;
  let store: MemoryStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sessmsg-stress-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fetchSessionMessages maps a large (2000-message) response promptly", async () => {
    const data = Array.from({ length: 2000 }, (_, i) => rawMsg("assistant", `line ${i} `, "x"));
    const client = mockClient(data);
    const start = Date.now();
    const msgs = await fetchSessionMessages(client, "s1");
    expect(msgs).toHaveLength(2000);
    expect(msgs[1999].content).toBe("line 1999 x");
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("stays idempotent across 50 repeated compactions of an overlapping window", async () => {
    // A growing conversation re-scanned on each compaction: the same decisions
    // recur, so dedup-by-id must keep stored auto-memories bounded.
    const base = [
      { role: "assistant", content: "We decided to use Redis for caching." },
      { role: "assistant", content: "Fixed the deadlock in the queue." },
      { role: "assistant", content: "Always use idempotency keys for writes." },
    ];
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      // window includes the recurring base plus some unique chatter that does not match
      await saveAutoMemories(store, [...base, { role: "user", content: `noise ${i}` }]);
    }
    expect(Date.now() - start).toBeLessThan(5000);
    // Exactly the 3 unique knowledge items — no growth from the 50 re-scans.
    const total =
      (await store.list("decision")).length +
      (await store.list("fix")).length +
      (await store.list("pattern")).length;
    expect(total).toBe(3);
  });
});

describe("coexistence with distillation (no conflict)", () => {
  let dir: string;
  let store: MemoryStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sessmsg-coexist-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("auto-memory and distillation persist distinct entries from the same session", async () => {
    const messages = [
      { role: "assistant", content: "We decided to use gRPC between services." },
      { role: "assistant", content: "Fixed the TLS handshake timeout." },
    ];
    // Both knowledge-capture paths run over the SAME session...
    const savedAuto = await saveAutoMemories(store, messages);
    const distill = new DistillationEngine(store);
    const result = await distill.distillSession("sess-1", messages);

    expect(savedAuto).toBeGreaterThanOrEqual(1);
    expect(result).toBeDefined();
    // ...and land in DISTINCT typed stores: auto-memory (decision/fix) vs
    // distillation. Neither overwrites the other.
    expect(
      (await store.list("decision")).length + (await store.list("fix")).length
    ).toBeGreaterThanOrEqual(2);
    expect((await store.list("distillation")).length).toBe(1);
  });
});
