// Hera Memory System - Persistent storage under ~/.config/opencode/hera-data/memory/

import { readdir, readFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { HeraMemory } from "../types.js";
import { heraLog } from "../logger.js";
import { DEFAULT_MEMORY_LIMIT } from "../constants.js";
import { atomicWriteJson } from "../helpers.js";

export interface MemoryStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export class MemoryStore {
  private dir: string;
  private maxEntries: number;
  private ttlMs: number | undefined;

  constructor(memoryDir: string, options: MemoryStoreOptions = {}) {
    this.dir = memoryDir;
    this.maxEntries = options.maxEntries ?? DEFAULT_MEMORY_LIMIT;
    this.ttlMs = options.ttlMs;
  }

  async init(): Promise<void> {
    for (const sub of [
      "sessions",
      "skills",
      "agents",
      "teams",
      "workflows",
      "distillations",
      "decisions",
      "fixes",
      "patterns",
      "preferences",
      "contexts",
      "team-messages",
      "team-sessions",
      "team-memory",
    ]) {
      await mkdir(join(this.dir, sub), { recursive: true });
    }
    await this.cleanupExpired();
  }

  async save(memory: HeraMemory): Promise<void> {
    assertSafeMemoryId(memory.id);
    const dirName = getSubdir(memory.type);
    const filePath = join(this.dir, dirName, `${memory.id}.json`);
    const memoryToSave = {
      ...memory,
      expiresAt: memory.expiresAt ?? this.defaultExpiresAt(memory.timestamp),
    };
    await atomicWriteJson(filePath, memoryToSave);
    await this.enforceLimit(memory.type);
  }

  async load(type: HeraMemory["type"], id: string): Promise<HeraMemory | null> {
    assertSafeMemoryId(id);
    try {
      const dirName = getSubdir(type);
      const filePath = join(this.dir, dirName, `${id}.json`);
      const content = await readFile(filePath, "utf-8");
      const memory = JSON.parse(content) as HeraMemory;
      if (isExpired(memory)) {
        await unlink(filePath);
        return null;
      }
      return memory;
    } catch (err) {
      heraLog("debug", `Failed to load memory: ${type}/${id}`, err);
      return null;
    }
  }

  async list(type?: HeraMemory["type"]): Promise<HeraMemory[]> {
    const typeMap: Record<string, string> = {
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
    const types = type ? [typeMap[type] ?? type] : Object.values(typeMap);
    const results: HeraMemory[] = [];
    for (const t of types) {
      const dir = join(this.dir, t);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            const filePath = join(dir, file);
            const content = await readFile(filePath, "utf-8");
            const memory = JSON.parse(content) as HeraMemory;
            if (isExpired(memory)) {
              await unlink(filePath);
            } else {
              results.push(memory);
            }
          }
        }
      } catch (err) {
        heraLog("debug", `Failed to list memory directory: ${dir}`, err);
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  async delete(type: HeraMemory["type"], id: string): Promise<boolean> {
    assertSafeMemoryId(id);
    try {
      const dirName = getSubdir(type);
      await unlink(join(this.dir, dirName, `${id}.json`));
      return true;
    } catch (err) {
      heraLog("debug", `Failed to delete memory: ${type}/${id}`, err);
      return false;
    }
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
    const entries = await this.list(type);
    if (entries.length <= this.maxEntries) return;
    const overflow = entries
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, entries.length - this.maxEntries);
    await Promise.all(overflow.map((memory) => this.delete(memory.type, memory.id)));
  }
}

function isExpired(memory: HeraMemory): boolean {
  return memory.expiresAt != null && memory.expiresAt <= Date.now();
}

function assertSafeMemoryId(id: string): void {
  if (!id || id.includes("..") || /[\\/\0]/.test(id)) {
    throw new Error("Memory id must not contain path traversal characters.");
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSubdir(type: string): string {
  const map: Record<string, string> = {
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
  return map[type] ?? `${type}s`;
}
