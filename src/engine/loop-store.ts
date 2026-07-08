// src/engine/loop-store.ts
import { join } from "node:path";
import { JsonCollectionStore } from "../store/json-collection-store.js";
import type { LoopDefinition, LoopMode, LoopStatus } from "./loop-types.js";

export class LoopStore {
  private store: JsonCollectionStore<LoopDefinition>;

  constructor(dataDir: string) {
    this.store = new JsonCollectionStore<LoopDefinition>(join(dataDir, "loops"), "records", {
      secondaryIndexes: {
        status: (l) => l.status,
        mode: (l) => l.mode,
      },
    });
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  async save(loop: LoopDefinition): Promise<void> {
    await this.store.save(loop);
  }

  /**
   * Atomic compare-and-set: the mutator sees the current stored loop and
   * returns the next value, or null/undefined to abort. Used by the tick paths
   * so a stale in-flight snapshot cannot resurrect a cancelled/paused loop.
   */
  async update(
    id: string,
    mutator: (current: LoopDefinition | null) => LoopDefinition | null | undefined
  ): Promise<LoopDefinition | null> {
    return this.store.update(id, mutator);
  }

  async get(id: string): Promise<LoopDefinition | null> {
    return this.store.load(id);
  }

  byStatus(status: LoopStatus): LoopDefinition[] {
    return this.store.byIndex("status", status);
  }

  byMode(mode: LoopMode): LoopDefinition[] {
    return this.store.byIndex("mode", mode);
  }

  async all(): Promise<LoopDefinition[]> {
    return this.store.list();
  }
}
