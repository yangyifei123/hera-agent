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

  /**
   * Atomic compare-and-set: the mutator sees the current stored record and
   * returns the next value, or null/undefined to abort the write. Used for
   * terminal transitions that must not clobber a concurrent cancel (e.g. the
   * executor saving a result after the task was cancelled mid-attempt).
   */
  async update(
    id: string,
    mutator: (current: TaskRecord | null) => TaskRecord | null | undefined
  ): Promise<TaskRecord | null> {
    return this.store.update(id, mutator);
  }

  /**
   * Like {@link update}, but reads the authoritative on-disk record before
   * mutating (bypassing the possibly-stale in-memory cache). Use for
   * cross-process-sensitive transitions — lease renewal — where a second
   * OpenCode process on the same data dir may hold a stale cache: a cache-first
   * read there could renew (and so resurrect) a lease that process legitimately
   * reclaimed. Matches the claim/reclaim paths, which also read from disk.
   */
  async updateFromDisk(
    id: string,
    mutator: (current: TaskRecord | null) => TaskRecord | null | undefined
  ): Promise<TaskRecord | null> {
    return this.store.updateFromDisk(id, mutator);
  }

  async get(id: string): Promise<TaskRecord | null> {
    return this.store.load(id);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
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
      // Lease via disk-authoritative compare-and-set: only claim if the record
      // is STILL pending and eligible at write time. Reading from disk (not the
      // possibly-stale cache) guards against a task being cancelled, already
      // leased (same-process re-entrancy), or claimed by ANOTHER process between
      // the byStatus() read above and this write.
      const leased = await this.store.updateFromDisk(task.id, (current) => {
        if (!current || current.status !== "pending") return undefined;
        if (current.nextEligibleAt != null && current.nextEligibleAt > now) return undefined;
        if (
          current.leaseOwner != null &&
          current.leaseExpiresAt != null &&
          current.leaseExpiresAt > now
        ) {
          return undefined;
        }
        return {
          ...current,
          status: "running",
          leaseOwner: owner,
          leaseExpiresAt: now + leaseMs,
          startedAt: current.startedAt ?? now,
          updatedAt: now,
        };
      });
      if (leased && leased.status === "running" && leased.leaseOwner === owner) {
        claimed.push(leased);
      }
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
    for (const candidate of this.byStatus("running")) {
      if (activeIds?.has(candidate.id)) continue;
      // Re-check the lease against the authoritative on-disk record: another
      // process may have refreshed this lease (heartbeat) since our cache was
      // populated, in which case the task is alive and must NOT be reclaimed.
      const reclaimed = await this.store.updateFromDisk(candidate.id, (task) => {
        if (!task || task.status !== "running") return undefined;
        if (activeIds?.has(task.id)) return undefined;
        if (task.leaseExpiresAt != null && task.leaseExpiresAt > now) return undefined;
        const attempts = task.attempts + 1;
        const exhausted = attempts >= task.maxAttempts;
        return {
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
        };
      });
      // updateFromDisk returns the current record on a dropped write; only count
      // an actual reclaim (status moved off running).
      if (reclaimed && reclaimed.status !== "running") count++;
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
    let count = 0;
    for (const task of this.byStatus("pending")) {
      // A dependency that (a) reached a terminal-failed state, or (b) has no
      // record at all (never enqueued / typo'd id), can never let this task
      // become ready — fail it rather than leave it stranded pending forever.
      const blocker = (task.dependsOn ?? []).find((dep) => dead.has(dep) || !this.store.has(dep));
      if (blocker) {
        const reason = dead.has(blocker)
          ? `dependency ${blocker} failed`
          : `dependency ${blocker} does not exist`;
        await this.save({
          ...task,
          status: "failed",
          lastError: reason,
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
