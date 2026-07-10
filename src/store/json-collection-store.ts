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
  /**
   * Per-id promise chain so concurrent mutations of the same id serialize.
   * Guards save / update / delete / cache-fill-on-load — everything that
   * touches an id's file or its cache/index entry.
   */
  private idLocks = new Map<string, Promise<void>>();

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
    let files: string[];
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
    // Serialize the full remove -> write -> insert cycle per id so two
    // interleaved saves of the same id cannot leave the in-memory cache
    // diverged from disk. Different ids still run concurrently.
    await this.withIdLock(entry.id, async () => {
      const existing = this.primary.get(entry.id);
      if (existing) this.indexRemove(existing);
      await atomicWriteJson(join(this.dir, `${entry.id}.json`), entry);
      this.indexInsert(entry);
    });
  }

  /**
   * Atomic read-modify-write under the per-id lock. `mutator` receives the
   * current record (from the in-memory cache, or disk on a cold miss) and
   * returns the next value to persist, or `null`/`undefined` to abort the write
   * (no-op). Because the read and the write happen inside the same lock, no
   * concurrent save/update/delete of the same id can interleave between them —
   * this is the primitive that stops a stale snapshot from resurrecting a
   * cancelled/paused record. Returns the persisted value, or the current value
   * when the mutation is aborted.
   *
   * The current value is read cache-first; within a single process the cache is
   * the freshest view (every writer goes through this lock). Cross-process
   * freshness (a second OpenCode process) is handled by callers that need it
   * via an explicit disk re-read.
   */
  async update(
    id: string,
    mutator: (current: T | null) => T | null | undefined
  ): Promise<T | null> {
    assertSafeId(id);
    let result: T | null = null;
    await this.withIdLock(id, async () => {
      const current = this.primary.get(id) ?? (await this.readFromDisk(id));
      const next = mutator(current);
      if (next == null) {
        result = current;
        return;
      }
      assertSafeId(next.id);
      const existing = this.primary.get(next.id);
      if (existing) this.indexRemove(existing);
      await atomicWriteJson(join(this.dir, `${next.id}.json`), next);
      this.indexInsert(next);
      result = next;
    });
    return result;
  }

  /**
   * Like {@link update}, but reads the CURRENT on-disk value (bypassing the
   * in-memory cache) before mutating. Use for cross-process-sensitive
   * transitions — claiming a task lease, reclaiming an expired one — where a
   * second OpenCode process on the same data dir holds a stale cache: a
   * cache-first read there would let both processes claim the same record.
   *
   * This is not a full distributed lock (two processes reading the file in the
   * same instant can still both proceed), but it shrinks the race from the
   * entire duration of cache staleness to the write window, and keeps the cache
   * coherent with what we just wrote. Same-process behavior is unchanged, since
   * disk and cache agree after every locked write.
   */
  async updateFromDisk(
    id: string,
    mutator: (current: T | null) => T | null | undefined
  ): Promise<T | null> {
    assertSafeId(id);
    let result: T | null = null;
    await this.withIdLock(id, async () => {
      const current = (await this.readFromDisk(id)) ?? this.primary.get(id) ?? null;
      const next = mutator(current);
      if (next == null) {
        result = current;
        return;
      }
      assertSafeId(next.id);
      const existing = this.primary.get(next.id);
      if (existing) this.indexRemove(existing);
      await atomicWriteJson(join(this.dir, `${next.id}.json`), next);
      this.indexInsert(next);
      result = next;
    });
    return result;
  }

  /**
   * Runs `fn` exclusively with respect to other in-flight calls for the same
   * id by chaining onto a per-id promise. Earlier failures never block later
   * callers (the stored chain swallows rejections), and the chain entry is
   * cleaned up once it is the tail, so the map does not grow unbounded.
   */
  private async withIdLock(id: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.idLocks.get(id) ?? Promise.resolve();
    const run = previous.then(fn);
    const guarded = run.catch(() => undefined);
    this.idLocks.set(id, guarded);
    try {
      await run;
    } finally {
      if (this.idLocks.get(id) === guarded) {
        this.idLocks.delete(id);
      }
    }
  }

  private async readFromDisk(id: string): Promise<T | null> {
    try {
      const content = await readFile(join(this.dir, `${id}.json`), "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async load(id: string): Promise<T | null> {
    assertSafeId(id);
    const cached = this.primary.get(id);
    if (cached) return cached;
    // Fill the cache under the id lock so a concurrent save's
    // indexRemove/indexInsert cannot interleave with this insert.
    let result: T | null = null;
    await this.withIdLock(id, async () => {
      const again = this.primary.get(id);
      if (again) {
        result = again;
        return;
      }
      const entry = await this.readFromDisk(id);
      if (entry) {
        this.indexInsert(entry);
        result = entry;
      }
    });
    return result;
  }

  async delete(id: string): Promise<boolean> {
    assertSafeId(id);
    let deleted = false;
    await this.withIdLock(id, async () => {
      const existing = this.primary.get(id);
      if (existing) this.indexRemove(existing);
      try {
        await unlink(join(this.dir, `${id}.json`));
        deleted = true;
      } catch {
        deleted = existing != null;
      }
    });
    return deleted;
  }

  async list(): Promise<T[]> {
    return Array.from(this.primary.values());
  }

  /**
   * Reconcile the in-memory cache with the current directory listing without a
   * full re-scan: load any `*.json` whose id is not already cached, and drop any
   * cached entry whose backing file has disappeared. Only NEW ids are read from
   * disk — unchanged, already-cached files are never re-read — so this stays
   * cheap enough to call on the read path (e.g. before a recall) to surface
   * memos an external writer dropped straight into the collection dir (a
   * generated plugin's inlined hera_remember). Init's lease-transition helpers
   * (update/updateFromDisk by id) are untouched.
   */
  async refreshFromDisk(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }
    const onDisk = new Set<string>();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      onDisk.add(file.slice(0, -".json".length));
    }
    // Load ids that appeared on disk but aren't cached yet (read only the new ones).
    for (const id of onDisk) {
      if (this.primary.has(id)) continue;
      await this.withIdLock(id, async () => {
        if (this.primary.has(id)) return;
        const entry = await this.readFromDisk(id);
        if (entry) this.indexInsert(entry);
      });
    }
    // Drop cached entries whose backing file has disappeared.
    for (const id of Array.from(this.primary.keys())) {
      if (onDisk.has(id)) continue;
      await this.withIdLock(id, async () => {
        const existing = this.primary.get(id);
        if (existing) this.indexRemove(existing);
      });
    }
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
      const idx = this.secondary.get(name);
      if (!idx) continue;
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
      const idx = this.secondary.get(name);
      if (!idx) continue;
      const set = idx.get(key);
      if (!set) continue;
      set.delete(entry.id);
      if (set.size === 0) idx.delete(key);
    }
  }
}
