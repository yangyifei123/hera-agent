// Hera Memory System - Persistent storage under ~/.config/opencode/hera-data/memory/

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { HeraMemory } from "../types.js";

export class MemoryStore {
  private dir: string;

  constructor(memoryDir: string) {
    this.dir = memoryDir;
  }

  async init(): Promise<void> {
    for (const sub of ["sessions", "skills", "agents", "teams", "distillations"]) {
      await mkdir(join(this.dir, sub), { recursive: true });
    }
  }

  async save(memory: HeraMemory): Promise<void> {
    const filePath = join(this.dir, `${memory.type}s`, `${memory.id}.json`);
    await writeFile(filePath, JSON.stringify(memory, null, 2), "utf-8");
  }

  async load(type: HeraMemory["type"], id: string): Promise<HeraMemory | null> {
    try {
      const filePath = join(this.dir, `${type}s`, `${id}.json`);
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as HeraMemory;
    } catch {
      return null;
    }
  }

  async list(type?: HeraMemory["type"]): Promise<HeraMemory[]> {
    const typeMap: Record<string, string> = {
      session: "sessions",
      skill: "skills",
      agent: "agents",
      team: "teams",
      distillation: "distillations",
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
      } catch {
        // skip
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  async delete(type: HeraMemory["type"], id: string): Promise<boolean> {
    try {
      await unlink(join(this.dir, `${type}s`, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string, type?: HeraMemory["type"]): Promise<HeraMemory[]> {
    const all = await this.list(type);
    const lower = query.toLowerCase();
    return all.filter(
      (m) =>
        m.content.toLowerCase().includes(lower) ||
        m.id.toLowerCase().includes(lower)
    );
  }
}
