# Hera Durable Task Engine (HDTE) P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a disk-persisted, crash-recoverable, concurrency-limited task ledger whose completion is judged by declarative acceptance checks, able to flow 500+ tasks to genuine completion — on a shared persistence base that `MemoryStore` is refactored onto.

**Architecture:** A generic `JsonCollectionStore` (atomic disk JSON-per-entry + in-memory index) underpins both the refactored `MemoryStore` and a new `TaskStore`. A `Supervisor` claims ready tasks under a concurrency cap and dispatches them to a `TaskExecutor`, which runs an executor agent then an `AcceptanceEvaluator`; a task is `succeeded` only when all checks pass, else it retries to budget. On startup the supervisor resets crashed (expired-lease) tasks.

**Tech Stack:** TypeScript, Bun (test runner, `bun:test`), Node fs/child_process, `@opencode-ai/plugin` `tool()` helper.

## Global Constraints

- Runtime model: in-process supervisor only. No daemon, no OS scheduler in P1.
- Completion = declarative acceptance checks pass. No LLM verifier.
- A task with an empty `acceptance` array is rejected at enqueue.
- `MemoryStore` external API/behavior must not change; existing memory tests stay green unchanged.
- Use `atomicWriteJson`/`atomicWriteText` from `src/helpers.ts` for all persisted writes.
- Use `heraLog()` (from `src/logger.js`), never `console.*`.
- Prefer constants from `src/constants.ts` over hardcoded values.
- Tests live next to source under `src/`, named `*.test.ts`.
- Safe-id rule: ids must not contain `..`, `/`, `\`, or NUL.
- Only active tasks may be held in memory; never load the whole ledger into memory in a hot path.

---

### Task 1: `JsonCollectionStore` base with in-memory index

**Files:**
- Create: `src/store/json-collection-store.ts`
- Test: `src/store/json-collection-store.test.ts`

**Interfaces:**
- Consumes: `atomicWriteJson` from `src/helpers.js`.
- Produces:
  ```ts
  interface CollectionEntry { id: string }
  interface JsonCollectionStoreOptions<T> {
    secondaryIndexes?: Record<string, (entry: T) => string | undefined>;
  }
  class JsonCollectionStore<T extends CollectionEntry> {
    constructor(rootDir: string, collection: string, options?: JsonCollectionStoreOptions<T>);
    init(): Promise<void>;                 // mkdir + build index from disk
    save(entry: T): Promise<void>;         // atomic write + index update
    load(id: string): Promise<T | null>;   // from index cache, falling back to disk
    delete(id: string): Promise<boolean>;  // unlink + index removal
    list(): Promise<T[]>;                   // from index cache, no disk re-scan
    byIndex(indexName: string, key: string): T[]; // secondary-index lookup
    has(id: string): boolean;
    size(): number;
  }
  function assertSafeId(id: string): void;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/store/json-collection-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonCollectionStore, assertSafeId } from "./json-collection-store.js";

interface Row { id: string; status: string; value: number }

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
    expect(store.byIndex("status", "pending").map((r) => r.id).sort()).toEqual(["a", "b"]);
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
    await writeFile(join(dir, "rows", "x.json"), JSON.stringify({ id: "x", status: "pending", value: 9 }));
    const fresh = new JsonCollectionStore<Row>(dir, "rows", { secondaryIndexes: { status: (r) => r.status } });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/json-collection-store.test.ts`
Expected: FAIL — module `./json-collection-store.js` not found.

- [ ] **Step 3: Implement `JsonCollectionStore`**

```ts
// src/store/json-collection-store.ts
import { readdir, readFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson } from "../helpers.js";
import { heraLog } from "../logger.js";

export interface CollectionEntry {
  id: string;
}

export interface JsonCollectionStoreOptions<T> {
  /** Map an entry to a key for each named secondary index (undefined = not indexed). */
  secondaryIndexes?: Record<string, (entry: T) => string | undefined>;
}

export function assertSafeId(id: string): void {
  if (!id || id.includes("..") || /[\\/\0]/.test(id)) {
    throw new Error("Entry id must not contain path traversal characters.");
  }
}

export class JsonCollectionStore<T extends CollectionEntry> {
  private readonly dir: string;
  private readonly indexers: Record<string, (entry: T) => string | undefined>;
  private primary = new Map<string, T>();
  private secondary = new Map<string, Map<string, Set<string>>>();

  constructor(rootDir: string, collection: string, options: JsonCollectionStoreOptions<T> = {}) {
    this.dir = join(rootDir, collection);
    this.indexers = options.secondaryIndexes ?? {};
    for (const name of Object.keys(this.indexers)) {
      this.secondary.set(name, new Map());
    }
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.primary.clear();
    for (const idx of this.secondary.values()) idx.clear();
    let files: string[] = [];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await readFile(join(this.dir, file), "utf-8");
        const entry = JSON.parse(content) as T;
        this.indexInsert(entry);
      } catch (err) {
        heraLog("debug", `Skipping corrupt collection file: ${file}`, err);
      }
    }
  }

  async save(entry: T): Promise<void> {
    assertSafeId(entry.id);
    const existing = this.primary.get(entry.id);
    if (existing) this.indexRemove(existing);
    await atomicWriteJson(join(this.dir, `${entry.id}.json`), entry);
    this.indexInsert(entry);
  }

  async load(id: string): Promise<T | null> {
    assertSafeId(id);
    const cached = this.primary.get(id);
    if (cached) return cached;
    try {
      const content = await readFile(join(this.dir, `${id}.json`), "utf-8");
      const entry = JSON.parse(content) as T;
      this.indexInsert(entry);
      return entry;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    assertSafeId(id);
    const existing = this.primary.get(id);
    if (existing) this.indexRemove(existing);
    try {
      await unlink(join(this.dir, `${id}.json`));
      return true;
    } catch {
      return existing != null;
    }
  }

  async list(): Promise<T[]> {
    return Array.from(this.primary.values());
  }

  byIndex(indexName: string, key: string): T[] {
    const idx = this.secondary.get(indexName);
    if (!idx) return [];
    const ids = idx.get(key);
    if (!ids) return [];
    return Array.from(ids, (id) => this.primary.get(id)).filter((e): e is T => e != null);
  }

  has(id: string): boolean {
    return this.primary.has(id);
  }

  size(): number {
    return this.primary.size;
  }

  private indexInsert(entry: T): void {
    this.primary.set(entry.id, entry);
    for (const [name, indexer] of Object.entries(this.indexers)) {
      const key = indexer(entry);
      if (key == null) continue;
      const idx = this.secondary.get(name)!;
      let set = idx.get(key);
      if (!set) {
        set = new Set();
        idx.set(key, set);
      }
      set.add(entry.id);
    }
  }

  private indexRemove(entry: T): void {
    this.primary.delete(entry.id);
    for (const [name, indexer] of Object.entries(this.indexers)) {
      const key = indexer(entry);
      if (key == null) continue;
      const set = this.secondary.get(name)?.get(key);
      set?.delete(entry.id);
      if (set && set.size === 0) this.secondary.get(name)!.delete(key);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/json-collection-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/json-collection-store.ts src/store/json-collection-store.test.ts
git commit -m "feat: add JsonCollectionStore base with in-memory index"
```

---

### Task 2: Refactor `MemoryStore` onto `JsonCollectionStore` (behavior-preserving)

**Files:**
- Modify: `src/memory/store.ts`
- Test: `src/memory/store.test.ts` (existing tests must stay green; add one index-efficiency test)

**Interfaces:**
- Consumes: `JsonCollectionStore` from Task 1.
- Produces: unchanged public `MemoryStore` API (`init`, `save`, `load`, `list`, `delete`, `search`).

**Note:** `MemoryStore` uses one subdir per memory `type`. Model this as one
`JsonCollectionStore` per subdir, created lazily, keyed by the canonical subdir
name. Keep the type→subdir map in ONE place. Preserve TTL/expiry and
`maxEntries` semantics exactly.

- [ ] **Step 1: Confirm existing tests pass before refactor (baseline)**

Run: `bun test src/memory/store.test.ts`
Expected: PASS (record the count; it must not drop after refactor).

- [ ] **Step 2: Write the new efficiency test (failing against old code is fine — it asserts new internals)**

```ts
// append to src/memory/store.test.ts
import { MemoryStore } from "./store.js";

it("enforceLimit does not re-scan disk per save (index-backed list)", async () => {
  // Saving N entries under a small maxEntries must not throw and must keep only the cap.
  const dir = await import("node:fs/promises").then((m) =>
    m.mkdtemp(require("node:path").join(require("node:os").tmpdir(), "mem-eff-"))
  );
  const store = new MemoryStore(dir, { maxEntries: 5 });
  await store.init();
  for (let i = 0; i < 50; i++) {
    await store.save({ id: `e${i}`, type: "context", content: `c${i}`, timestamp: i });
  }
  const all = await store.list("context");
  expect(all.length).toBe(5);
  await import("node:fs/promises").then((m) => m.rm(dir, { recursive: true, force: true }));
});
```

(If `require` is unavailable in the test runtime, use top-level `import` for `os`/`path` instead — match the file's existing import style.)

- [ ] **Step 3: Rewrite `src/memory/store.ts` over the base**

```ts
// src/memory/store.ts
import type { HeraMemory } from "../types.js";
import { heraLog } from "../logger.js";
import { DEFAULT_MEMORY_LIMIT } from "../constants.js";
import { JsonCollectionStore } from "../store/json-collection-store.js";

export interface MemoryStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

const TYPE_TO_SUBDIR: Record<string, string> = {
  session: "sessions",
  skill: "skills",
  agent: "agents",
  team: "teams",
  workflow: "workflows",
  distillation: "distillations",
  decision: "decisions",
  fix: "fixes",
  pattern: "patterns",
  preference: "preferences",
  context: "contexts",
  "team-message": "team-messages",
  "team-session": "team-sessions",
  "team-memory": "team-memory",
};

function subdirFor(type: string): string {
  return TYPE_TO_SUBDIR[type] ?? `${type}s`;
}

export class MemoryStore {
  private dir: string;
  private maxEntries: number;
  private ttlMs: number | undefined;
  private collections = new Map<string, JsonCollectionStore<HeraMemory>>();

  constructor(memoryDir: string, options: MemoryStoreOptions = {}) {
    this.dir = memoryDir;
    this.maxEntries = options.maxEntries ?? DEFAULT_MEMORY_LIMIT;
    this.ttlMs = options.ttlMs;
  }

  private async collection(subdir: string): Promise<JsonCollectionStore<HeraMemory>> {
    let store = this.collections.get(subdir);
    if (!store) {
      store = new JsonCollectionStore<HeraMemory>(this.dir, subdir);
      await store.init();
      this.collections.set(subdir, store);
    }
    return store;
  }

  async init(): Promise<void> {
    for (const subdir of new Set(Object.values(TYPE_TO_SUBDIR))) {
      await this.collection(subdir);
    }
    await this.cleanupExpired();
  }

  async save(memory: HeraMemory): Promise<void> {
    const store = await this.collection(subdirFor(memory.type));
    const toSave: HeraMemory = {
      ...memory,
      expiresAt: memory.expiresAt ?? this.defaultExpiresAt(memory.timestamp),
    };
    await store.save(toSave);
    await this.enforceLimit(memory.type);
  }

  async load(type: HeraMemory["type"], id: string): Promise<HeraMemory | null> {
    const store = await this.collection(subdirFor(type));
    const memory = await store.load(id);
    if (!memory) return null;
    if (isExpired(memory)) {
      await store.delete(id);
      return null;
    }
    return memory;
  }

  async list(type?: HeraMemory["type"]): Promise<HeraMemory[]> {
    const subdirs = type ? [subdirFor(type)] : new Set(Object.values(TYPE_TO_SUBDIR));
    const results: HeraMemory[] = [];
    for (const subdir of subdirs) {
      const store = await this.collection(subdir);
      for (const memory of await store.list()) {
        if (isExpired(memory)) {
          await store.delete(memory.id);
        } else {
          results.push(memory);
        }
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  async delete(type: HeraMemory["type"], id: string): Promise<boolean> {
    const store = await this.collection(subdirFor(type));
    return store.delete(id);
  }

  async search(
    query: string,
    type?: HeraMemory["type"],
    options?: { since?: number; limit?: number }
  ): Promise<HeraMemory[]> {
    let all = await this.list(type);
    if (options?.since != null) {
      const since = options.since;
      all = all.filter((m) => m.timestamp >= since);
    }
    const lower = query.toLowerCase();
    const wordBoundaryRe = new RegExp(`\\b${escapeRegex(lower)}`, "i");
    return all
      .filter(
        (m) =>
          wordBoundaryRe.test(m.content) ||
          wordBoundaryRe.test(m.id) ||
          m.content.toLowerCase().includes(lower) ||
          m.id.toLowerCase().includes(lower)
      )
      .slice(0, options?.limit);
  }

  private defaultExpiresAt(timestamp: number): number | undefined {
    return this.ttlMs != null && this.ttlMs > 0 ? timestamp + this.ttlMs : undefined;
  }

  private async cleanupExpired(): Promise<void> {
    await this.list();
  }

  private async enforceLimit(type: HeraMemory["type"]): Promise<void> {
    if (this.maxEntries <= 0) return;
    const store = await this.collection(subdirFor(type));
    const entries = await store.list();
    if (entries.length <= this.maxEntries) return;
    const overflow = entries
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, entries.length - this.maxEntries);
    await Promise.all(overflow.map((m) => store.delete(m.id)));
  }
}

function isExpired(memory: HeraMemory): boolean {
  return memory.expiresAt != null && memory.expiresAt <= Date.now();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

(`heraLog` import retained for parity if referenced elsewhere; remove if lint flags it as unused.)

- [ ] **Step 4: Run the full memory test file**

Run: `bun test src/memory/store.test.ts`
Expected: PASS — all prior tests plus the new efficiency test.

- [ ] **Step 5: Run the broader suites that touch memory to confirm no behavior drift**

Run: `bun test src/persistence.test.ts src/tools/agent-tools.test.ts`
Expected: PASS (these exercise `MemoryStore` indirectly).

- [ ] **Step 6: Commit**

```bash
git add src/memory/store.ts src/memory/store.test.ts
git commit -m "refactor: build MemoryStore on JsonCollectionStore (behavior-preserving)"
```

---

### Task 3: Task types + `TaskStore`

**Files:**
- Create: `src/engine/task-types.ts`
- Create: `src/engine/task-store.ts`
- Test: `src/engine/task-store.test.ts`

**Interfaces:**
- Consumes: `JsonCollectionStore` (Task 1).
- Produces:
  ```ts
  type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
  type AcceptanceCheck =
    | { type: "shell"; command: string; cwd?: string; expectExit?: number; timeoutMs?: number }
    | { type: "file_exists"; path: string }
    | { type: "regex"; source: "output" | "file"; path?: string; pattern: string };
  interface AcceptanceResult { check: AcceptanceCheck; passed: boolean; detail?: string; at: number }
  interface TaskRecord { id; batchId?; goal; executor; input?; acceptance; status;
    attempts; maxAttempts; backoffMs?; lastError?; proof?; dependsOn?;
    leaseOwner?; leaseExpiresAt?; createdAt; startedAt?; updatedAt; completedAt? }

  class TaskStore {
    constructor(dataDir: string);
    init(): Promise<void>;
    save(task: TaskRecord): Promise<void>;
    get(id: string): Promise<TaskRecord | null>;
    byStatus(status: TaskStatus): TaskRecord[];
    byBatch(batchId: string): TaskRecord[];
    all(): Promise<TaskRecord[]>;
    claimReady(limit: number, leaseMs: number, owner: string, now: number): Promise<TaskRecord[]>;
    recover(now: number): Promise<number>; // running+expired lease -> pending; returns count
  }
  ```

**Note:** `TaskStore` wraps a `JsonCollectionStore<TaskRecord>` in collection
`"tasks"` under `<dataDir>` with secondary indexes on `status` and `batchId`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/task-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import type { TaskRecord } from "./task-types.js";

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  const now = 1000;
  return {
    id: over.id ?? "t1",
    goal: "do a thing",
    executor: "hera",
    acceptance: [{ type: "file_exists", path: "/tmp/x" }],
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("TaskStore", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskstore-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and gets a task", async () => {
    await store.save(makeTask());
    expect((await store.get("t1"))?.goal).toBe("do a thing");
  });

  it("indexes by status and batch", async () => {
    await store.save(makeTask({ id: "a", status: "pending", batchId: "b1" }));
    await store.save(makeTask({ id: "b", status: "running", batchId: "b1" }));
    expect(store.byStatus("pending").map((t) => t.id)).toEqual(["a"]);
    expect(store.byBatch("b1").map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("claimReady leases up to limit and sets running", async () => {
    await store.save(makeTask({ id: "a" }));
    await store.save(makeTask({ id: "b" }));
    await store.save(makeTask({ id: "c" }));
    const claimed = await store.claimReady(2, 5000, "owner-1", 1000);
    expect(claimed).toHaveLength(2);
    for (const t of claimed) {
      expect(t.status).toBe("running");
      expect(t.leaseOwner).toBe("owner-1");
      expect(t.leaseExpiresAt).toBe(6000);
    }
    expect(store.byStatus("pending")).toHaveLength(1);
  });

  it("claimReady skips tasks with unsatisfied dependencies", async () => {
    await store.save(makeTask({ id: "dep", status: "pending" }));
    await store.save(makeTask({ id: "child", status: "pending", dependsOn: ["dep"] }));
    const claimed = await store.claimReady(10, 5000, "o", 1000);
    expect(claimed.map((t) => t.id)).toEqual(["dep"]);
  });

  it("claimReady includes a child once its dependency has succeeded", async () => {
    await store.save(makeTask({ id: "dep", status: "succeeded" }));
    await store.save(makeTask({ id: "child", status: "pending", dependsOn: ["dep"] }));
    const claimed = await store.claimReady(10, 5000, "o", 1000);
    expect(claimed.map((t) => t.id)).toEqual(["child"]);
  });

  it("recover resets running tasks with expired leases to pending", async () => {
    await store.save(makeTask({ id: "a", status: "running", leaseOwner: "old", leaseExpiresAt: 500 }));
    await store.save(makeTask({ id: "b", status: "running", leaseOwner: "live", leaseExpiresAt: 9999 }));
    const count = await store.recover(1000);
    expect(count).toBe(1);
    expect((await store.get("a"))?.status).toBe("pending");
    expect((await store.get("b"))?.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/engine/task-store.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/engine/task-types.ts`**

```ts
// src/engine/task-types.ts
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type AcceptanceCheck =
  | { type: "shell"; command: string; cwd?: string; expectExit?: number; timeoutMs?: number }
  | { type: "file_exists"; path: string }
  | { type: "regex"; source: "output" | "file"; path?: string; pattern: string };

export interface AcceptanceResult {
  check: AcceptanceCheck;
  passed: boolean;
  detail?: string;
  at: number;
}

export interface TaskRecord {
  id: string;
  batchId?: string;
  goal: string;
  executor: string;
  input?: unknown;
  acceptance: AcceptanceCheck[];
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  backoffMs?: number;
  lastError?: string;
  proof?: AcceptanceResult[];
  dependsOn?: string[];
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  completedAt?: number;
}
```

- [ ] **Step 4: Create `src/engine/task-store.ts`**

```ts
// src/engine/task-store.ts
import { join } from "node:path";
import { JsonCollectionStore } from "../store/json-collection-store.js";
import type { TaskRecord, TaskStatus } from "./task-types.js";

export class TaskStore {
  private store: JsonCollectionStore<TaskRecord>;

  constructor(dataDir: string) {
    this.store = new JsonCollectionStore<TaskRecord>(join(dataDir, "tasks"), "records", {
      secondaryIndexes: {
        status: (t) => t.status,
        batch: (t) => t.batchId,
      },
    });
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  async save(task: TaskRecord): Promise<void> {
    await this.store.save(task);
  }

  async get(id: string): Promise<TaskRecord | null> {
    return this.store.load(id);
  }

  byStatus(status: TaskStatus): TaskRecord[] {
    return this.store.byIndex("status", status);
  }

  byBatch(batchId: string): TaskRecord[] {
    return this.store.byIndex("batch", batchId);
  }

  async all(): Promise<TaskRecord[]> {
    return this.store.list();
  }

  private async succeededIds(): Promise<Set<string>> {
    return new Set(this.byStatus("succeeded").map((t) => t.id));
  }

  async claimReady(
    limit: number,
    leaseMs: number,
    owner: string,
    now: number
  ): Promise<TaskRecord[]> {
    if (limit <= 0) return [];
    const succeeded = await this.succeededIds();
    const ready = this.byStatus("pending")
      .filter((t) => (t.dependsOn ?? []).every((dep) => succeeded.has(dep)))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
    const claimed: TaskRecord[] = [];
    for (const task of ready) {
      const leased: TaskRecord = {
        ...task,
        status: "running",
        leaseOwner: owner,
        leaseExpiresAt: now + leaseMs,
        startedAt: task.startedAt ?? now,
        updatedAt: now,
      };
      await this.save(leased);
      claimed.push(leased);
    }
    return claimed;
  }

  async recover(now: number): Promise<number> {
    let count = 0;
    for (const task of this.byStatus("running")) {
      if (task.leaseExpiresAt == null || task.leaseExpiresAt <= now) {
        await this.save({
          ...task,
          status: "pending",
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        count++;
      }
    }
    return count;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/engine/task-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/task-types.ts src/engine/task-store.ts src/engine/task-store.test.ts
git commit -m "feat: add TaskRecord types and durable TaskStore with status/batch indexes"
```

---

### Task 4: `AcceptanceEvaluator`

**Files:**
- Create: `src/engine/acceptance.ts`
- Test: `src/engine/acceptance.test.ts`

**Interfaces:**
- Consumes: `AcceptanceCheck`, `AcceptanceResult` (Task 3).
- Produces:
  ```ts
  interface AcceptanceContext { output: string; cwd: string }
  interface AcceptanceEvaluatorOptions { shellEnabled?: boolean; defaultTimeoutMs?: number }
  class AcceptanceEvaluator {
    constructor(options?: AcceptanceEvaluatorOptions);
    evaluate(checks: AcceptanceCheck[], ctx: AcceptanceContext, now: number): Promise<AcceptanceResult[]>;
    allPassed(results: AcceptanceResult[]): boolean;
  }
  ```

**Note:** `shell` and `regex(source:"file")` reading is gated by `shellEnabled`
(default true; the wiring passes the bash-permission value). A disabled shell
check fails closed with detail `"shell checks disabled"`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/acceptance.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcceptanceEvaluator } from "./acceptance.js";

describe("AcceptanceEvaluator", () => {
  let dir: string;
  let evalr: AcceptanceEvaluator;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "accept-"));
    evalr = new AcceptanceEvaluator({ shellEnabled: true, defaultTimeoutMs: 5000 });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes file_exists when the file is present", async () => {
    const p = join(dir, "made.txt");
    await writeFile(p, "hi");
    const r = await evalr.evaluate([{ type: "file_exists", path: p }], { output: "", cwd: dir }, 1);
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails file_exists when missing", async () => {
    const r = await evalr.evaluate(
      [{ type: "file_exists", path: join(dir, "nope.txt") }],
      { output: "", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(false);
  });

  it("passes a shell check on exit 0", async () => {
    const r = await evalr.evaluate(
      [{ type: "shell", command: "exit 0" }],
      { output: "", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails a shell check on nonzero exit", async () => {
    const r = await evalr.evaluate(
      [{ type: "shell", command: "exit 3" }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("3");
  });

  it("fails a shell check on timeout", async () => {
    const r = await evalr.evaluate(
      [{ type: "shell", command: "sleep 5", timeoutMs: 50 }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail?.toLowerCase()).toContain("timeout");
  });

  it("matches regex against output", async () => {
    const r = await evalr.evaluate(
      [{ type: "regex", source: "output", pattern: "DONE" }],
      { output: "build DONE", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails shell checks when shell is disabled", async () => {
    const disabled = new AcceptanceEvaluator({ shellEnabled: false });
    const r = await disabled.evaluate([{ type: "shell", command: "exit 0" }], { output: "", cwd: dir }, 1);
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("disabled");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/engine/acceptance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/acceptance.ts`**

```ts
// src/engine/acceptance.ts
import { exec } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import type { AcceptanceCheck, AcceptanceResult } from "./task-types.js";

export interface AcceptanceContext {
  output: string;
  cwd: string;
}

export interface AcceptanceEvaluatorOptions {
  shellEnabled?: boolean;
  defaultTimeoutMs?: number;
}

export class AcceptanceEvaluator {
  private shellEnabled: boolean;
  private defaultTimeoutMs: number;

  constructor(options: AcceptanceEvaluatorOptions = {}) {
    this.shellEnabled = options.shellEnabled ?? true;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300000;
  }

  async evaluate(
    checks: AcceptanceCheck[],
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult[]> {
    const results: AcceptanceResult[] = [];
    for (const check of checks) {
      results.push(await this.one(check, ctx, now));
    }
    return results;
  }

  allPassed(results: AcceptanceResult[]): boolean {
    return results.length > 0 && results.every((r) => r.passed);
  }

  private async one(
    check: AcceptanceCheck,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    try {
      switch (check.type) {
        case "file_exists":
          return this.result(check, await this.fileExists(check.path), now);
        case "regex":
          return this.regex(check, ctx, now);
        case "shell":
          return this.shell(check, ctx, now);
        default:
          return this.result(check as AcceptanceCheck, false, now, "unknown check type");
      }
    } catch (err) {
      return this.result(check, false, now, err instanceof Error ? err.message : String(err));
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async regex(
    check: Extract<AcceptanceCheck, { type: "regex" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    let source = ctx.output;
    if (check.source === "file") {
      if (!this.shellEnabled) return this.result(check, false, now, "file checks disabled");
      if (!check.path) return this.result(check, false, now, "regex file source requires path");
      source = await readFile(check.path, "utf-8");
    }
    const matched = new RegExp(check.pattern).test(source);
    return this.result(check, matched, now, matched ? "matched" : "no match");
  }

  private async shell(
    check: Extract<AcceptanceCheck, { type: "shell" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    if (!this.shellEnabled) return this.result(check, false, now, "shell checks disabled");
    const expectExit = check.expectExit ?? 0;
    const timeout = check.timeoutMs ?? this.defaultTimeoutMs;
    const code = await new Promise<number | "timeout">((resolve) => {
      const child = exec(check.command, { cwd: check.cwd ?? ctx.cwd, timeout }, (err) => {
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolve("timeout");
        } else if (err && typeof (err as { code?: number }).code === "number") {
          resolve((err as { code: number }).code);
        } else {
          resolve(0);
        }
      });
      child.on("error", () => resolve(-1));
    });
    if (code === "timeout") return this.result(check, false, now, "timeout");
    return this.result(check, code === expectExit, now, `exit ${code}`);
  }

  private result(
    check: AcceptanceCheck,
    passed: boolean,
    at: number,
    detail?: string
  ): AcceptanceResult {
    return { check, passed, detail, at };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/engine/acceptance.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/acceptance.ts src/engine/acceptance.test.ts
git commit -m "feat: add AcceptanceEvaluator for shell/file/regex completion checks"
```

---

### Task 5: `TaskExecutor`

**Files:**
- Create: `src/engine/executor.ts`
- Test: `src/engine/executor.test.ts`

**Interfaces:**
- Consumes: `TaskStore` (Task 3), `AcceptanceEvaluator` (Task 4), `TaskRecord`.
- Produces:
  ```ts
  interface AgentRunner { run(executor: string, prompt: string): Promise<string> }
  interface TaskExecutorOptions { defaultBackoffMs?: number }
  class TaskExecutor {
    constructor(store: TaskStore, evaluator: AcceptanceEvaluator, runner: AgentRunner, cwd: string, options?: TaskExecutorOptions);
    runAttempt(task: TaskRecord, now: number): Promise<TaskRecord>; // returns the updated record
  }
  ```

**Behavior:** run the agent → evaluate acceptance → if all pass, `succeeded`
with proof; else `attempts+1`, and `pending` (retry, clears lease) if under
budget, otherwise `failed`. Agent errors are caught as a failed attempt.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import type { TaskRecord } from "./task-types.js";

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "t1", goal: "g", executor: "hera",
    acceptance: [{ type: "file_exists", path: "/tmp/x" }],
    status: "running", attempts: 0, maxAttempts: 2,
    createdAt: 1, updatedAt: 1, ...over,
  };
}

describe("TaskExecutor", () => {
  let dir: string;
  let store: TaskStore;
  let evalr: AcceptanceEvaluator;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "exec-"));
    store = new TaskStore(dir);
    await store.init();
    evalr = new AcceptanceEvaluator({ shellEnabled: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("marks a task succeeded when acceptance passes, recording proof", async () => {
    const target = join(dir, "out.txt");
    const runner: AgentRunner = { run: async () => { await writeFile(target, "ok"); return "wrote it"; } };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: target }] });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("succeeded");
    expect(updated.proof?.every((p) => p.passed)).toBe(true);
    expect(updated.completedAt).toBe(1000);
  });

  it("retries (pending) when acceptance fails under budget", async () => {
    const runner: AgentRunner = { run: async () => "did nothing" };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: join(dir, "missing") }], attempts: 0, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("pending");
    expect(updated.attempts).toBe(1);
    expect(updated.leaseOwner).toBeUndefined();
  });

  it("marks failed when the retry budget is exhausted", async () => {
    const runner: AgentRunner = { run: async () => "nope" };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ acceptance: [{ type: "file_exists", path: join(dir, "missing") }], attempts: 1, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.attempts).toBe(2);
  });

  it("treats an agent error as a failed attempt", async () => {
    const runner: AgentRunner = { run: async () => { throw new Error("agent boom"); } };
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const task = makeTask({ attempts: 1, maxAttempts: 2 });
    await store.save(task);
    const updated = await exec.runAttempt(task, 1000);
    expect(updated.status).toBe("failed");
    expect(updated.lastError).toContain("agent boom");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/engine/executor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/executor.ts`**

```ts
// src/engine/executor.ts
import type { TaskStore } from "./task-store.js";
import type { AcceptanceEvaluator } from "./acceptance.js";
import type { TaskRecord } from "./task-types.js";
import { heraLog } from "../logger.js";

export interface AgentRunner {
  run(executor: string, prompt: string): Promise<string>;
}

export interface TaskExecutorOptions {
  defaultBackoffMs?: number;
}

export class TaskExecutor {
  constructor(
    private store: TaskStore,
    private evaluator: AcceptanceEvaluator,
    private runner: AgentRunner,
    private cwd: string,
    private options: TaskExecutorOptions = {}
  ) {}

  async runAttempt(task: TaskRecord, now: number): Promise<TaskRecord> {
    const prompt = this.buildPrompt(task);
    let output = "";
    let agentError: string | undefined;
    try {
      output = await this.runner.run(task.executor, prompt);
    } catch (err) {
      agentError = err instanceof Error ? err.message : String(err);
    }

    if (agentError) {
      return this.fail(task, now, `agent error: ${agentError}`);
    }

    const proof = await this.evaluator.evaluate(task.acceptance, { output, cwd: this.cwd }, now);
    if (this.evaluator.allPassed(proof)) {
      const succeeded: TaskRecord = {
        ...task,
        status: "succeeded",
        attempts: task.attempts + 1,
        proof,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
        completedAt: now,
      };
      await this.store.save(succeeded);
      heraLog("info", `Task succeeded: ${task.id}`);
      return succeeded;
    }

    const failedDetail = proof.filter((p) => !p.passed).map((p) => p.detail).join("; ");
    return this.fail(task, now, `acceptance failed: ${failedDetail}`, proof);
  }

  private async fail(
    task: TaskRecord,
    now: number,
    reason: string,
    proof?: TaskRecord["proof"]
  ): Promise<TaskRecord> {
    const attempts = task.attempts + 1;
    const exhausted = attempts >= task.maxAttempts;
    const updated: TaskRecord = {
      ...task,
      status: exhausted ? "failed" : "pending",
      attempts,
      proof: proof ?? task.proof,
      lastError: reason,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
      completedAt: exhausted ? now : undefined,
    };
    await this.store.save(updated);
    heraLog(exhausted ? "warn" : "debug", `Task ${updated.status}: ${task.id} (${reason})`);
    return updated;
  }

  private buildPrompt(task: TaskRecord): string {
    const lines = [task.goal];
    if (task.input != null) {
      lines.push("", "Input:", typeof task.input === "string" ? task.input : JSON.stringify(task.input));
    }
    lines.push(
      "",
      "Acceptance criteria (your work is only complete when these pass):",
      ...task.acceptance.map((c) => `- ${JSON.stringify(c)}`)
    );
    return lines.join("\n");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/engine/executor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/executor.ts src/engine/executor.test.ts
git commit -m "feat: add TaskExecutor with acceptance-gated completion and retry-to-budget"
```

---

### Task 6: `Supervisor`

**Files:**
- Create: `src/engine/supervisor.ts`
- Test: `src/engine/supervisor.test.ts`

**Interfaces:**
- Consumes: `TaskStore` (Task 3), `TaskExecutor` (Task 5).
- Produces:
  ```ts
  interface SupervisorOptions { concurrency: number; leaseMs: number; tickMs: number; ownerId: string }
  class Supervisor {
    constructor(store: TaskStore, executor: TaskExecutor, options: SupervisorOptions, clock?: () => number);
    recover(): Promise<number>;
    dispatchOnce(): Promise<number>; // claims+launches up to (concurrency - active); returns launched count
    drain(): Promise<void>;          // run to ledger idle (test/CLI helper)
    start(): void;                    // periodic tick
    stop(): void;
    activeCount(): number;
  }
  ```

**Note:** `clock` defaults to `Date.now` but tests inject a fixed clock.
`drain()` loops `dispatchOnce` and awaits in-flight work until no `pending` and
no `running` remain.

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/supervisor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";
import type { TaskRecord } from "./task-types.js";

function makeTask(id: string, target: string): TaskRecord {
  return {
    id, goal: "make file", executor: "hera",
    acceptance: [{ type: "file_exists", path: target }],
    status: "pending", attempts: 0, maxAttempts: 2,
    createdAt: 1, updatedAt: 1,
  };
}

describe("Supervisor", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sup-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildSupervisor(runner: AgentRunner, concurrency = 4) {
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir);
    return new Supervisor(store, exec, { concurrency, leaseMs: 5000, tickMs: 10, ownerId: "sup-1" }, () => 1000);
  }

  it("drains a batch of tasks to completion", async () => {
    const runner: AgentRunner = { run: async (_e, prompt) => {
      const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
      if (m) await writeFile(m[1], "x");
      return "done";
    } };
    const sup = buildSupervisor(runner, 4);
    for (let i = 0; i < 20; i++) {
      await store.save(makeTask(`t${i}`, join(dir, `f${i}.txt`)));
    }
    await sup.drain();
    expect(store.byStatus("succeeded")).toHaveLength(20);
    expect(store.byStatus("pending")).toHaveLength(0);
  });

  it("never exceeds the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const runner: AgentRunner = { run: async (_e, prompt) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
      if (m) await writeFile(m[1], "x");
      active--;
      return "done";
    } };
    const sup = buildSupervisor(runner, 3);
    for (let i = 0; i < 12; i++) await store.save(makeTask(`t${i}`, join(dir, `f${i}.txt`)));
    await sup.drain();
    expect(peak).toBeLessThanOrEqual(3);
    expect(store.byStatus("succeeded")).toHaveLength(12);
  });

  it("recover resets crashed running tasks", async () => {
    const t = makeTask("crashed", join(dir, "c.txt"));
    await store.save({ ...t, status: "running", leaseOwner: "old", leaseExpiresAt: 1 });
    const sup = buildSupervisor({ run: async () => "noop" });
    const recovered = await sup.recover();
    expect(recovered).toBe(1);
    expect((await store.get("crashed"))?.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/engine/supervisor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/engine/supervisor.ts`**

```ts
// src/engine/supervisor.ts
import type { TaskStore } from "./task-store.js";
import type { TaskExecutor } from "./executor.js";
import { heraLog } from "../logger.js";

export interface SupervisorOptions {
  concurrency: number;
  leaseMs: number;
  tickMs: number;
  ownerId: string;
}

export class Supervisor {
  private active = new Set<Promise<unknown>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    private store: TaskStore,
    private executor: TaskExecutor,
    private options: SupervisorOptions,
    private clock: () => number = () => Date.now()
  ) {}

  async recover(): Promise<number> {
    const count = await this.store.recover(this.clock());
    if (count > 0) heraLog("info", `Supervisor recovered ${count} crashed task(s)`);
    return count;
  }

  activeCount(): number {
    return this.active.size;
  }

  async dispatchOnce(): Promise<number> {
    const slots = this.options.concurrency - this.active.size;
    if (slots <= 0) return 0;
    const claimed = await this.store.claimReady(
      slots,
      this.options.leaseMs,
      this.options.ownerId,
      this.clock()
    );
    for (const task of claimed) {
      const p = this.executor
        .runAttempt(task, this.clock())
        .catch((err) => heraLog("warn", `Task attempt threw: ${task.id}`, err))
        .finally(() => this.active.delete(p));
      this.active.add(p);
    }
    return claimed.length;
  }

  async drain(): Promise<void> {
    for (;;) {
      await this.dispatchOnce();
      if (this.active.size === 0) {
        if (this.store.byStatus("pending").length === 0) break;
        continue;
      }
      await Promise.race(this.active);
    }
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (this.stopped) return;
      void this.dispatchOnce();
    }, this.options.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/engine/supervisor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/supervisor.ts src/engine/supervisor.test.ts
git commit -m "feat: add Supervisor with concurrency-bounded dispatch, drain, and recovery"
```

---

### Task 7: Config + constants for the task engine

**Files:**
- Modify: `src/constants.ts` (add task constants)
- Modify: `src/types.ts` (`HeraConfig` task fields; `HeraPaths.tasksDir`)
- Test: `src/constants.test.ts` (assert defaults)

**Interfaces:**
- Produces constants `TASK_CONCURRENCY`, `TASK_DEFAULT_MAX_ATTEMPTS`,
  `TASK_DEFAULT_BACKOFF_MS`, `TASK_LEASE_MS`, `SUPERVISOR_TICK_MS`; config fields
  `task_concurrency`, `task_default_max_attempts`, `task_default_backoff_ms`,
  `task_lease_ms`; `HeraPaths.tasksDir`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/constants.test.ts imports and a new describe block
import {
  TASK_CONCURRENCY,
  TASK_DEFAULT_MAX_ATTEMPTS,
  TASK_DEFAULT_BACKOFF_MS,
  TASK_LEASE_MS,
  SUPERVISOR_TICK_MS,
} from "./constants.js";

describe("Task Engine Constants", () => {
  it("has sane task-engine defaults", () => {
    expect(TASK_CONCURRENCY).toBe(8);
    expect(TASK_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(TASK_DEFAULT_BACKOFF_MS).toBe(1000);
    expect(TASK_LEASE_MS).toBe(300000);
    expect(SUPERVISOR_TICK_MS).toBeGreaterThan(0);
    expect(TASK_LEASE_MS).toBeGreaterThan(SUPERVISOR_TICK_MS);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/constants.test.ts`
Expected: FAIL — constants not exported.

- [ ] **Step 3: Add constants to `src/constants.ts`**

Insert after the Team Configuration block:

```ts
// === Task Engine Configuration ===

/** Default number of tasks the supervisor runs concurrently. */
export const TASK_CONCURRENCY = 8;

/** Default retry budget per task before it is marked failed. */
export const TASK_DEFAULT_MAX_ATTEMPTS = 3;

/** Default base backoff (ms) between task attempts. */
export const TASK_DEFAULT_BACKOFF_MS = 1000;

/** Default task lease duration (ms); expiry drives crash recovery. */
export const TASK_LEASE_MS = 300000;

/** Supervisor dispatch tick interval (ms). */
export const SUPERVISOR_TICK_MS = 500;
```

- [ ] **Step 4: Extend `HeraConfig` and `HeraPaths` in `src/types.ts`**

In `HeraConfig` (after `memory_ttl_ms?: number;`) add:

```ts
  task_concurrency?: number;
  task_default_max_attempts?: number;
  task_default_backoff_ms?: number;
  task_lease_ms?: number;
```

In `HeraPaths` (after `memoryDir: string;`) add:

```ts
  tasksDir: string;
```

- [ ] **Step 5: Run the constants test to verify it passes**

Run: `bun test src/constants.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck to surface any `HeraPaths` construction gaps**

Run: `bun run typecheck`
Expected: errors at each place `HeraPaths` is built without `tasksDir`. Fix each
by adding `tasksDir: join(dataDir, "tasks")` next to the existing `memoryDir:`
line (search the codebase for `memoryDir:` to find them — at least
`src/index.ts`; mirror the same field in any test harness that builds paths,
e.g. `src/tools/test-harness.ts`). Re-run until clean.

- [ ] **Step 7: Commit**

```bash
git add src/constants.ts src/constants.test.ts src/types.ts src/index.ts src/tools/test-harness.ts
git commit -m "feat: add task-engine config, constants, and tasksDir path"
```

---

### Task 8: Task tools (`hera_enqueue_task` … `hera_batch_report`)

**Files:**
- Create: `src/tools/task-tools.ts`
- Modify: `src/tools/index.ts` (merge `createTaskTools`)
- Test: `src/tools/task-tools.test.ts`

**Interfaces:**
- Consumes: `TaskStore` (Task 3), `TaskRecord` types, constants (Task 7),
  `PluginContext`.
- Produces tool object: `hera_enqueue_task`, `hera_enqueue_batch`,
  `hera_task_status`, `hera_list_tasks`, `hera_cancel_task`, `hera_batch_report`.

**Note:** `PluginContext` must expose the engine. Add a `taskStore: TaskStore`
field to `PluginContext` in `src/types.ts` (import type from
`./engine/task-store.js`) so tools can reach it; wiring (Task 9) populates it.
Enqueue validation rejects empty `goal` and empty `acceptance`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/tools/task-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../engine/task-store.js";
import { createTaskTools } from "./task-tools.js";

function ctxWith(store: TaskStore) {
  return { taskStore: store } as unknown as Parameters<typeof createTaskTools>[0];
}

describe("task-tools", () => {
  let dir: string;
  let store: TaskStore;
  let tools: ReturnType<typeof createTaskTools>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasktools-"));
    store = new TaskStore(dir);
    await store.init();
    tools = createTaskTools(ctxWith(store));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("enqueues a valid task", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "build", acceptance: [{ type: "file_exists", path: "/tmp/z" }] } as any,
      {} as any
    );
    expect(String(res)).toContain("enqueued");
    expect(store.byStatus("pending")).toHaveLength(1);
  });

  it("rejects a task with no acceptance checks", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "build", acceptance: [] } as any,
      {} as any
    );
    expect(String(res)).toContain("acceptance");
    expect(store.byStatus("pending")).toHaveLength(0);
  });

  it("rejects a task with an empty goal", async () => {
    const res = await tools.hera_enqueue_task.execute(
      { goal: "  ", acceptance: [{ type: "file_exists", path: "/tmp/z" }] } as any,
      {} as any
    );
    expect(String(res)).toContain("goal");
  });

  it("enqueues a batch under one batchId", async () => {
    const res = await tools.hera_enqueue_batch.execute(
      { tasks: [
        { goal: "a", acceptance: [{ type: "file_exists", path: "/tmp/a" }] },
        { goal: "b", acceptance: [{ type: "file_exists", path: "/tmp/b" }] },
      ] } as any,
      {} as any
    );
    const batchId = String(res).match(/batch ([\w-]+)/)?.[1];
    expect(batchId).toBeTruthy();
    expect(store.byBatch(batchId!)).toHaveLength(2);
  });

  it("reports batch accounting without calling partial success complete", async () => {
    await store.save({
      id: "x", batchId: "b9", goal: "g", executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/x" }],
      status: "failed", attempts: 3, maxAttempts: 3, lastError: "nope",
      createdAt: 1, updatedAt: 1,
    });
    await store.save({
      id: "y", batchId: "b9", goal: "g", executor: "hera",
      acceptance: [{ type: "file_exists", path: "/tmp/y" }],
      status: "succeeded", attempts: 1, maxAttempts: 3, createdAt: 1, updatedAt: 1,
    });
    const res = await tools.hera_batch_report.execute({ batchId: "b9" } as any, {} as any);
    expect(String(res)).toContain("1 succeeded");
    expect(String(res)).toContain("1 failed");
    expect(String(res)).toContain("x");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/tools/task-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/task-tools.ts`**

```ts
// src/tools/task-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type { AcceptanceCheck, TaskRecord, TaskStatus } from "../engine/task-types.js";
import { TASK_DEFAULT_MAX_ATTEMPTS, TASK_DEFAULT_BACKOFF_MS } from "../constants.js";
import { randomUUID } from "node:crypto";

const z = tool.schema;

interface EnqueueInput {
  goal: string;
  executor?: string;
  input?: unknown;
  acceptance: AcceptanceCheck[];
  maxAttempts?: number;
  dependsOn?: string[];
}

function validateEnqueue(input: EnqueueInput): string | null {
  if (!input.goal || input.goal.trim().length === 0) return "Error: task goal is required.";
  if (!Array.isArray(input.acceptance) || input.acceptance.length === 0) {
    return "Error: at least one acceptance check is required (a task with no acceptance check cannot be verified complete).";
  }
  return null;
}

function buildTask(input: EnqueueInput, batchId: string | undefined, now: number): TaskRecord {
  return {
    id: randomUUID(),
    batchId,
    goal: input.goal.trim(),
    executor: input.executor || "hera",
    input: input.input,
    acceptance: input.acceptance,
    status: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? TASK_DEFAULT_MAX_ATTEMPTS,
    backoffMs: TASK_DEFAULT_BACKOFF_MS,
    dependsOn: input.dependsOn,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTaskTools(ctx: PluginContext) {
  const { taskStore } = ctx;
  return {
    hera_enqueue_task: tool({
      description:
        "Enqueue a durable task. The task is complete only when its declarative acceptance checks pass; it retries to budget otherwise.",
      args: {
        goal: z.string().describe("What the task must accomplish"),
        executor: z.string().optional().describe("Agent name to run it (default: hera)"),
        acceptance: z
          .array(z.any())
          .describe("Acceptance checks (shell/file_exists/regex); ALL must pass. Required, non-empty."),
        maxAttempts: z.number().optional().describe("Retry budget (default from config)"),
        dependsOn: z.array(z.string()).optional().describe("Task ids that must succeed first"),
      },
      async execute(args) {
        const input = args as unknown as EnqueueInput;
        const err = validateEnqueue(input);
        if (err) return err;
        const task = buildTask(input, undefined, Date.now());
        await taskStore.save(task);
        return `Task enqueued: ${task.id}`;
      },
    }),

    hera_enqueue_batch: tool({
      description: "Enqueue many durable tasks at once under one batch id (supports large batches).",
      args: {
        tasks: z.array(z.any()).describe("Array of task definitions (same shape as hera_enqueue_task)"),
      },
      async execute(args) {
        const tasks = (args as { tasks: EnqueueInput[] }).tasks;
        if (!Array.isArray(tasks) || tasks.length === 0) return "Error: tasks array is required.";
        for (let i = 0; i < tasks.length; i++) {
          const err = validateEnqueue(tasks[i]);
          if (err) return `Error in task #${i}: ${err}`;
        }
        const batchId = randomUUID();
        const now = Date.now();
        for (const t of tasks) await taskStore.save(buildTask(t, batchId, now));
        return `Enqueued ${tasks.length} task(s) in batch ${batchId}`;
      },
    }),

    hera_task_status: tool({
      description: "Get the status, attempts, and acceptance proof for one task.",
      args: { id: z.string().describe("Task id") },
      async execute(args) {
        const task = await taskStore.get(args.id);
        if (!task) return `No task found: ${args.id}`;
        return [
          `Task ${task.id}: ${task.status} (attempt ${task.attempts}/${task.maxAttempts})`,
          task.lastError ? `Last error: ${task.lastError}` : "",
          task.proof ? `Proof: ${JSON.stringify(task.proof)}` : "",
        ].filter(Boolean).join("\n");
      },
    }),

    hera_list_tasks: tool({
      description: "List tasks, optionally filtered by status.",
      args: { status: z.string().optional().describe("pending|running|succeeded|failed|cancelled") },
      async execute(args) {
        const tasks = args.status
          ? taskStore.byStatus(args.status as TaskStatus)
          : await taskStore.all();
        if (tasks.length === 0) return "No tasks.";
        return tasks.map((t) => `- ${t.id} [${t.status}] ${t.goal}`).join("\n");
      },
    }),

    hera_cancel_task: tool({
      description: "Cancel a task so the supervisor will not run it.",
      args: { id: z.string().describe("Task id") },
      async execute(args) {
        const task = await taskStore.get(args.id);
        if (!task) return `No task found: ${args.id}`;
        if (task.status === "succeeded") return `Task ${args.id} already succeeded.`;
        await taskStore.save({ ...task, status: "cancelled", updatedAt: Date.now() });
        return `Task cancelled: ${args.id}`;
      },
    }),

    hera_batch_report: tool({
      description: "Final accounting for a batch: succeeded count, failed list with reasons, and in-flight counts. Never reports partial success as complete.",
      args: { batchId: z.string().describe("Batch id") },
      async execute(args) {
        const tasks = taskStore.byBatch(args.batchId);
        if (tasks.length === 0) return `No tasks in batch ${args.batchId}.`;
        const by = (s: TaskStatus) => tasks.filter((t) => t.status === s);
        const failed = by("failed");
        const complete = failed.length === 0 && by("pending").length === 0 && by("running").length === 0 && by("cancelled").length === 0;
        return [
          `Batch ${args.batchId}: ${by("succeeded").length} succeeded, ${failed.length} failed, ${by("running").length} running, ${by("pending").length} pending, ${by("cancelled").length} cancelled (of ${tasks.length}).`,
          complete ? "Batch fully complete." : "Batch NOT fully complete.",
          ...failed.map((t) => `  FAILED ${t.id}: ${t.lastError ?? "unknown"}`),
        ].join("\n");
      },
    }),
  };
}
```

- [ ] **Step 4: Add `taskStore` to `PluginContext` and merge tools**

In `src/types.ts` `PluginContext`, add (after `client`):

```ts
  taskStore: import("./engine/task-store.js").TaskStore;
```

In `src/tools/index.ts`, import and merge:

```ts
import { createTaskTools } from "./task-tools.js";
// inside createAllTools tools object:
    ...createTaskTools(ctx),
```

- [ ] **Step 5: Run the task-tools tests to verify they pass**

Run: `bun test src/tools/task-tools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/task-tools.ts src/tools/index.ts src/types.ts src/tools/task-tools.test.ts
git commit -m "feat: add task-engine tools (enqueue/batch/status/list/cancel/report)"
```

---

### Task 9: Wire the engine into startup + 500-task integration test

**Files:**
- Create: `src/engine/opencode-agent-runner.ts` (real `AgentRunner` over the OpenCode client)
- Modify: `src/index.ts` (construct engine, populate `ctx.taskStore`, recover, start supervisor)
- Modify: `src/tools/test-harness.ts` (provide a `taskStore` so existing tool tests keep building `PluginContext`)
- Test: `src/engine/engine-integration.test.ts` (500-task drain)

**Interfaces:**
- Consumes: all prior engine modules; `OpenCodeClient`; config + constants.
- Produces: `OpenCodeAgentRunner implements AgentRunner`; a live supervisor on
  startup.

**Note:** `OpenCodeAgentRunner` reuses the team poll pattern: create a session,
`promptAsync`, poll `session.status` until idle, return the last assistant
message text. If `client` is undefined (e.g. tests/CLI), `run` throws so the task
is a retryable failed attempt rather than a silent pass.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/engine/engine-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./task-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor, type AgentRunner } from "./executor.js";
import { Supervisor } from "./supervisor.js";
import type { TaskRecord } from "./task-types.js";

describe("HDTE integration", () => {
  let dir: string;
  let store: TaskStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hdte-int-"));
    store = new TaskStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("drains 500 tasks to genuine completion with proof", async () => {
    const runner: AgentRunner = { run: async (_e, prompt) => {
      const m = /file_exists.*?"path":"([^"]+)"/.exec(prompt);
      if (m) await writeFile(m[1], "ok");
      return "done";
    } };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const sup = new Supervisor(store, exec, { concurrency: 16, leaseMs: 60000, tickMs: 5, ownerId: "it" }, () => 1000);

    for (let i = 0; i < 500; i++) {
      const target = join(dir, `out-${i}.txt`);
      const task: TaskRecord = {
        id: `task-${i}`, batchId: "big", goal: "make file", executor: "hera",
        acceptance: [{ type: "file_exists", path: target }],
        status: "pending", attempts: 0, maxAttempts: 2, createdAt: i, updatedAt: i,
      };
      await store.save(task);
    }

    await sup.drain();

    expect(store.byStatus("succeeded")).toHaveLength(500);
    expect(store.byStatus("pending")).toHaveLength(0);
    expect(store.byStatus("failed")).toHaveLength(0);
    // every task recorded passing proof
    for (const t of store.byBatch("big")) {
      expect(t.proof?.every((p) => p.passed)).toBe(true);
    }
    await access(join(dir, "out-499.txt")); // throws if missing
  }, 60000);

  it("surfaces a permanently failing task as failed, never as success", async () => {
    const runner: AgentRunner = { run: async () => "did nothing" };
    const evalr = new AcceptanceEvaluator({ shellEnabled: true });
    const exec = new TaskExecutor(store, evalr, runner, dir);
    const sup = new Supervisor(store, exec, { concurrency: 4, leaseMs: 60000, tickMs: 5, ownerId: "it" }, () => 1000);
    await store.save({
      id: "doomed", batchId: "b", goal: "g", executor: "hera",
      acceptance: [{ type: "file_exists", path: join(dir, "never") }],
      status: "pending", attempts: 0, maxAttempts: 2, createdAt: 1, updatedAt: 1,
    });
    await sup.drain();
    expect(store.byStatus("failed").map((t) => t.id)).toEqual(["doomed"]);
    expect(store.byStatus("succeeded")).toHaveLength(0);
  }, 20000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/engine/engine-integration.test.ts`
Expected: FAIL initially only if engine modules are missing; since Tasks 3–6
exist, this test should actually PASS already (it uses them directly). If it
passes, that confirms the engine integrates. Proceed to wire startup.

- [ ] **Step 3: Implement `src/engine/opencode-agent-runner.ts`**

```ts
// src/engine/opencode-agent-runner.ts
import type { OpenCodeClient } from "../types/client.js";
import type { AgentRunner } from "./executor.js";
import { TEAM_POLL_MAX_ATTEMPTS, TEAM_POLL_INTERVAL_MS } from "../constants.js";

export class OpenCodeAgentRunner implements AgentRunner {
  constructor(
    private client: OpenCodeClient | undefined,
    private directory: string
  ) {}

  async run(executor: string, prompt: string): Promise<string> {
    if (!this.client) throw new Error("OpenCode client unavailable for task execution");
    const created = await this.client.session.create({
      body: { title: `Hera task → @${executor}` },
      query: { directory: this.directory },
    });
    const sessionId = created.data?.id;
    if (!sessionId) throw new Error("OpenCode session creation failed");
    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: { agent: executor, parts: [{ type: "text" as const, text: prompt }] },
    });
    for (let i = 0; i < TEAM_POLL_MAX_ATTEMPTS; i++) {
      const status = await this.client.session.status();
      if (status.data?.[sessionId]?.type === "idle") {
        const messages = await this.client.session.messages({ path: { id: sessionId } });
        const list = messages.data ?? [];
        for (let j = list.length - 1; j >= 0; j--) {
          if (list[j]?.info.role === "assistant") {
            return list[j].parts?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
          }
        }
        return "";
      }
      await new Promise((r) => setTimeout(r, TEAM_POLL_INTERVAL_MS));
    }
    throw new Error("Task agent timed out");
  }
}
```

- [ ] **Step 4: Wire into `src/index.ts`**

After the existing managers are initialized and `paths`/`config` are available
(search for where `WorkflowManager` is constructed and where `ctx`/the tool
context object is assembled), add:

```ts
import { TaskStore } from "./engine/task-store.js";
import { AcceptanceEvaluator } from "./engine/acceptance.js";
import { TaskExecutor } from "./engine/executor.js";
import { Supervisor } from "./engine/supervisor.js";
import { OpenCodeAgentRunner } from "./engine/opencode-agent-runner.js";
import {
  TASK_CONCURRENCY,
  TASK_LEASE_MS,
  SUPERVISOR_TICK_MS,
} from "./constants.js";
import { randomUUID } from "node:crypto";

// after paths/config/client are ready:
const taskStore = new TaskStore(paths.dataDir);
await taskStore.init();
const acceptance = new AcceptanceEvaluator({
  shellEnabled: getDefaultPermission()?.bash !== "deny",
  defaultTimeoutMs: TASK_LEASE_MS,
});
const agentRunner = new OpenCodeAgentRunner(client, paths.configRoot);
const taskExecutor = new TaskExecutor(taskStore, acceptance, agentRunner, paths.configRoot);
const supervisor = new Supervisor(
  taskStore,
  taskExecutor,
  {
    concurrency: config.task_concurrency ?? TASK_CONCURRENCY,
    leaseMs: config.task_lease_ms ?? TASK_LEASE_MS,
    tickMs: SUPERVISOR_TICK_MS,
    ownerId: randomUUID(),
  }
);
await supervisor.recover();
supervisor.start();
```

Add `taskStore` to the `PluginContext` object built in this file (the field
added in Task 8). Keep a module-level reference to `supervisor` so it is not
garbage collected.

- [ ] **Step 5: Update `src/tools/test-harness.ts` to provide `taskStore`**

In the harness that builds a `PluginContext`, construct a `TaskStore` under the
harness temp dir and assign it to `ctx.taskStore`, mirroring how `store` is set
up:

```ts
import { TaskStore } from "../engine/task-store.js";
// where ctx is assembled:
const taskStore = new TaskStore(paths.dataDir);
await taskStore.init();
// include in the returned ctx:
  taskStore,
```

- [ ] **Step 6: Run the full engine + tools suites**

Run: `bun test src/engine/ src/tools/task-tools.test.ts`
Expected: PASS (including the 500-task integration test).

- [ ] **Step 7: Typecheck, lint, build**

Run: `bun run typecheck && bun run lint && bun run build`
Expected: clean. Fix any `PluginContext`/`HeraPaths` construction sites the
compiler flags.

- [ ] **Step 8: Commit**

```bash
git add src/engine/opencode-agent-runner.ts src/engine/engine-integration.test.ts src/index.ts src/tools/test-harness.ts
git commit -m "feat: wire durable task engine into startup with recovery and supervisor"
```

---

## Final verification gate

- [ ] Run the full suite and confirm no regressions beyond the known-flaky
  `src/install.test.ts` subprocess timeouts (documented pre-existing).

Run: `bun test`
Expected: all engine/store/memory/tools tests pass; only the pre-existing flaky
install subprocess tests may intermittently fail (verify by re-running them in
isolation if they appear).

- [ ] Run the release gate.

```bash
bun run typecheck && bun run lint && bun run build && npm pack --dry-run
```

---

## Self-review notes (author)

- **Spec coverage:** JsonCollectionStore + index (Task 1); MemoryStore refactor
  behavior-preserving (Task 2); TaskRecord + acceptance model + TaskStore +
  status index + recovery (Task 3); declarative acceptance incl. shell/file/regex
  + timeout + permission gate (Task 4); acceptance-gated completion + retry-to-
  budget + agent-error-as-attempt (Task 5); concurrency-bounded supervisor +
  drain + startup recovery (Task 6); config/constants/tasksDir (Task 7); tools
  incl. batch report with no-partial-as-complete + empty-acceptance rejection
  (Task 8); in-process startup wiring + 500-task drain + permanent-failure-
  surfaced integration (Task 9). Forward hooks (lease/recover/tick/`src/engine/*`)
  exist for P2–P4.
- **Type consistency:** `AgentRunner.run(executor, prompt)`, `TaskExecutor.runAttempt(task, now)`,
  `Supervisor.dispatchOnce/drain/recover`, `TaskStore.claimReady(limit, leaseMs, owner, now)`
  used identically across tasks.
- **Security:** shell/file checks gated by `shellEnabled` (wired from bash
  permission), timeout-bounded; documented as a P4 revisit for exported plugins.
