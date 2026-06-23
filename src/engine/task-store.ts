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
