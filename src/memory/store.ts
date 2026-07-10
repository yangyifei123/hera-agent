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
      // Pick up memos an external writer (e.g. a generated plugin's inlined
      // hera_remember) dropped straight into the collection dir since the last
      // scan, so recall/list see them without a process restart. Cheap: only
      // newly-appeared files are read.
      await store.refreshFromDisk();
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
    options?: { since?: number; limit?: number; excludeTypes?: string[] }
  ): Promise<HeraMemory[]> {
    let all = await this.list(type);
    if (options?.since != null) {
      const since = options.since;
      all = all.filter((m) => m.timestamp >= since);
    }
    if (options?.excludeTypes && options.excludeTypes.length > 0) {
      const excluded = new Set(options.excludeTypes);
      all = all.filter((m) => !excluded.has(m.type));
    }
    const lower = query.toLowerCase().trim();
    const terms = lower.split(/\s+/).filter(Boolean);

    // Empty query returns everything (recency order from list()), since/limit still apply.
    if (terms.length === 0) return all.slice(0, options?.limit);

    // Tokenized, term-coverage relevance ranking. A multi-word query like
    // "login token error" matches memories containing those terms anywhere
    // (not only the exact contiguous phrase), ranked by how many terms hit and
    // whether the whole phrase / the id matched; ties break by recency.
    return all
      .map((m) => ({ m, score: relevanceScore(m, lower, terms) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.m.timestamp - a.m.timestamp)
      .map((s) => s.m)
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
    // Only evict non-protected entries, oldest first. An entry flagged
    // `metadata.protected` (e.g. an unacknowledged directed team message) is
    // never evicted by the generic cap — its owner (TeamManager) controls its
    // retention. If protected entries alone exceed the cap, the collection is
    // allowed to stay above it rather than drop a message a recipient still owes.
    const overflow = entries.length - this.maxEntries;
    const toDelete = entries
      .filter((m) => m.metadata?.protected !== true)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, overflow);
    await Promise.all(toDelete.map((m) => store.delete(m.id)));
  }
}

function isExpired(memory: HeraMemory): boolean {
  // A protected entry (unacknowledged directed team message) never auto-expires,
  // even past its TTL — the same guarantee TeamManager's own pruning makes.
  if (memory.metadata?.protected === true) return false;
  return memory.expiresAt != null && memory.expiresAt <= Date.now();
}

/**
 * Relevance score for a memory against a tokenized query. 0 means "no match"
 * (excluded). Higher is more relevant: whole-phrase presence, per-term
 * word-boundary hits (weighted higher than loose substring), id/title matches,
 * and a term-coverage bonus.
 */
function relevanceScore(m: HeraMemory, lower: string, terms: string[]): number {
  const content = m.content.toLowerCase();
  const id = m.id.toLowerCase();
  const hay = `${content} ${id}`;
  let score = 0;
  let matched = 0;
  if (content.includes(lower) || id.includes(lower)) score += 10; // exact phrase present
  for (const t of terms) {
    const wordBoundary = new RegExp(`\\b${escapeRegex(t)}`);
    if (wordBoundary.test(hay)) {
      matched++;
      score += 2;
      if (id.includes(t)) score += 1; // id/title matches weigh more
    } else if (hay.includes(t)) {
      matched++;
      score += 1;
    }
  }
  if (matched === 0) return 0;
  score += (matched / terms.length) * 3; // reward broader term coverage
  return score;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
