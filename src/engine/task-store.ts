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
      // honor retry backoff: a task re-queued after a failure is not eligible
      // until its nextEligibleAt has passed.
      .filter((t) => t.nextEligibleAt == null || t.nextEligibleAt <= now)
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

  /**
   * Reclaim orphaned `running` tasks whose lease has expired (crash / lease
   * timeout). Each reclaim counts as an attempt so a task that repeatedly
   * crashes the host (and thus never reaches executor.fail) cannot retry
   * forever — once attempts exhaust maxAttempts it is moved to `failed`.
   *
   * `activeIds` are task ids this process is still actively running; they are
   * never reclaimed even with an expired lease, preventing the same task from
   * being dispatched twice concurrently (duplicate side effects).
   */
  async recover(now: number, activeIds?: ReadonlySet<string>): Promise<number> {
    let count = 0;
    for (const task of this.byStatus("running")) {
      if (activeIds?.has(task.id)) continue;
      if (task.leaseExpiresAt == null || task.leaseExpiresAt <= now) {
        const attempts = task.attempts + 1;
        const exhausted = attempts >= task.maxAttempts;
        await this.save({
          ...task,
          status: exhausted ? "failed" : "pending",
          attempts,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          lastError: exhausted
            ? "reclaimed after crash/lease-expiry: max attempts exhausted"
            : (task.lastError ?? "reclaimed after crash/lease-expiry"),
          updatedAt: now,
          completedAt: exhausted ? now : undefined,
        });
        count++;
      }
    }
    return count;
  }

  /**
   * Cascade terminal dependency failures: a `pending` task that depends on a
   * `failed`/`cancelled` task can never become ready, so mark it `failed`
   * instead of leaving it stranded forever (which would block batch completion
   * and burn a supervisor scan every tick). Returns how many were failed.
   */
  async failBlockedTasks(now: number): Promise<number> {
    const dead = new Set<string>([
      ...this.byStatus("failed").map((t) => t.id),
      ...this.byStatus("cancelled").map((t) => t.id),
    ]);
    if (dead.size === 0) return 0;
    let count = 0;
    for (const task of this.byStatus("pending")) {
      const blocker = (task.dependsOn ?? []).find((dep) => dead.has(dep));
      if (blocker) {
        await this.save({
          ...task,
          status: "failed",
          lastError: `dependency ${blocker} failed`,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
          completedAt: now,
        });
        count++;
      }
    }
    return count;
  }
}
