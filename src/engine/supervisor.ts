// src/engine/supervisor.ts
import type { TaskStore } from "./task-store.js";
import type { TaskExecutor } from "./executor.js";
import { heraLog } from "../logger.js";

export interface SupervisorOptions {
  concurrency: number;
  leaseMs: number;
  tickMs: number;
  ownerId: string;
}

export class Supervisor {
  private active = new Set<Promise<unknown>>();
  private activeIds = new Set<string>();
  /** AbortController per in-flight task, so a cancel can stop its attempt. */
  private controllers = new Map<string, AbortController>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private dispatching = false;
  private reclaimedCount = 0;

  constructor(
    private store: TaskStore,
    private executor: TaskExecutor,
    private options: SupervisorOptions,
    private clock: () => number = () => Date.now()
  ) {}

  async recover(): Promise<number> {
    const count = await this.store.recover(this.clock(), this.activeIds);
    await this.store.failBlockedTasks(this.clock());
    if (count > 0) heraLog("info", `Supervisor recovered ${count} crashed task(s)`);
    return count;
  }

  activeCount(): number {
    return this.active.size;
  }

  stats(): { active: number; reclaimed: number; concurrency: number } {
    return {
      active: this.active.size,
      reclaimed: this.reclaimedCount,
      concurrency: this.options.concurrency,
    };
  }

  async dispatchOnce(): Promise<number> {
    if (this.dispatching) return 0;
    this.dispatching = true;
    try {
      this.reclaimedCount += await this.store.recover(this.clock(), this.activeIds);
      await this.store.failBlockedTasks(this.clock());
      const slots = this.options.concurrency - this.active.size;
      if (slots <= 0) return 0;
      const claimed = await this.store.claimReady(
        slots,
        this.options.leaseMs,
        this.options.ownerId,
        this.clock()
      );
      for (const task of claimed) {
        this.activeIds.add(task.id);
        const controller = new AbortController();
        this.controllers.set(task.id, controller);
        const p = this.executor
          .runAttempt(task, this.clock(), controller.signal)
          .catch((err) => heraLog("warn", `Task attempt threw: ${task.id}`, err))
          .finally(() => {
            this.active.delete(p);
            this.activeIds.delete(task.id);
            this.controllers.delete(task.id);
          });
        this.active.add(p);
      }
      return claimed.length;
    } finally {
      this.dispatching = false;
    }
  }

  async drain(): Promise<void> {
    for (;;) {
      await this.dispatchOnce();
      if (this.active.size === 0) {
        if (this.store.byStatus("pending").length === 0) break;
        await new Promise((r) => setTimeout(r, this.options.tickMs));
        continue;
      }
      await Promise.race(this.active);
    }
  }

  /**
   * Extend the lease of every task this process is actively running so a
   * legitimately long attempt (whose acceptance evaluation can outlive the
   * original lease) is not falsely reclaimed and re-dispatched as a duplicate.
   * Only renews a task still marked running under THIS owner.
   */
  async heartbeat(): Promise<void> {
    if (this.activeIds.size === 0) return;
    const now = this.clock();
    const renewedExpiry = now + this.options.leaseMs;
    for (const id of this.activeIds) {
      // Read the authoritative on-disk record before renewing (like claimReady/
      // recover): a cache-first renewal could extend a lease that ANOTHER
      // process already reclaimed after our cache went stale, re-dispatching the
      // task as a duplicate.
      const cur = await this.store.updateFromDisk(id, (t) => {
        // A task cancelled while its attempt is in flight: don't renew — signal
        // the abort below so the underlying session is torn down.
        if (t && t.status === "cancelled") return undefined;
        return t && t.status === "running" && t.leaseOwner === this.options.ownerId
          ? { ...t, leaseExpiresAt: renewedExpiry, updatedAt: now }
          : undefined;
      });
      if (cur && cur.status === "cancelled") {
        this.controllers.get(id)?.abort();
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (this.stopped) return;
      // Renew leases then dispatch, and never let a rejection escape the timer
      // callback as an unhandled rejection (fatal on some runtimes).
      this.heartbeat()
        .then(() => this.dispatchOnce())
        .catch((err) => heraLog("warn", "Supervisor tick failed", err));
    }, this.options.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
