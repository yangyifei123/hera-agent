// Hera Memory System - Persistent storage under ~/.config/opencode/hera-data/memory/

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { HeraMemory } from "../types.js";
import { heraLog } from "../logger.js";

export class MemoryStore {
  private dir: string;

  constructor(memoryDir: string) {
    this.dir = memoryDir;
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
    ]) {
      await mkdir(join(this.dir, sub), { recursive: true });
    }
  }

  async save(memory: HeraMemory): Promise<void> {
    const dirName = getSubdir(memory.type);
    const filePath = join(this.dir, dirName, `${memory.id}.json`);
    await writeFile(filePath, JSON.stringify(memory, null, 2), "utf-8");
  }

  async load(type: HeraMemory["type"], id: string): Promise<HeraMemory | null> {
    try {
      const dirName = getSubdir(type);
      const filePath = join(this.dir, dirName, `${id}.json`);
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as HeraMemory;
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
    };
    const types = type ? [typeMap[type] ?? type] : Object.values(typeMap);
    const results: HeraMemory[] = [];
    for (const t of types) {
      const dir = join(this.dir, t);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (file.endsWith(".json")) {
            const content = await readFile(join(dir, file), "utf-8");
            results.push(JSON.parse(content));
          }
        }
      } catch (err) {
        heraLog("debug", `Failed to list memory directory: ${dir}`, err);
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  async delete(type: HeraMemory["type"], id: string): Promise<boolean> {
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
      all = all.filter((m) => m.timestamp >= options.since!);
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
  };
  return map[type] ?? `${type}s`;
}
