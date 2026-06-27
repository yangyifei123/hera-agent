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
  /** Per-id promise chain so concurrent saves of the same id serialize. */
  private saveLocks = new Map<string, Promise<void>>();

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
   * Runs `fn` exclusively with respect to other in-flight calls for the same
   * id by chaining onto a per-id promise. Earlier failures never block later
   * callers (the stored chain swallows rejections), and the chain entry is
   * cleaned up once it is the tail, so the map does not grow unbounded.
   */
  private async withIdLock(id: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.saveLocks.get(id) ?? Promise.resolve();
    const run = previous.then(fn);
    const guarded = run.catch(() => undefined);
    this.saveLocks.set(id, guarded);
    try {
      await run;
    } finally {
      if (this.saveLocks.get(id) === guarded) {
        this.saveLocks.delete(id);
      }
    }
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
