// Hera Memory System - Persistent storage under ~/.config/opencode/hera-data/memory/

import type { HeraMemory } from "../types.js";
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
    const subdirs = type
      ? [subdirFor(type)]
      : (new Set(Object.values(TYPE_TO_SUBDIR)) as Set<string>);
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
