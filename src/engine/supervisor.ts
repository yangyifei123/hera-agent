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
    const count = await this.store.recover(this.clock());
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
      this.reclaimedCount += await this.store.recover(this.clock());
      const slots = this.options.concurrency - this.active.size;
      if (slots <= 0) return 0;
      const claimed = await this.store.claimReady(
        slots,
        this.options.leaseMs,
        this.options.ownerId,
        this.clock()
      );
      for (const task of claimed) {
        const p = this.executor
          .runAttempt(task, this.clock())
          .catch((err) => heraLog("warn", `Task attempt threw: ${task.id}`, err))
          .finally(() => this.active.delete(p));
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

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (this.stopped) return;
      void this.dispatchOnce();
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
