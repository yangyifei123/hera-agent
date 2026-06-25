// src/engine/loop-manager.ts
import { randomUUID } from "node:crypto";
import type { LoopStore } from "./loop-store.js";
import type { TaskStore } from "./task-store.js";
import type { AcceptanceEvaluator } from "./acceptance.js";
import type { AcceptanceCheck, TaskRecord } from "./task-types.js";
import type { LoopDefinition, LoopMode, LoopStatus, LoopTaskTemplate } from "./loop-types.js";
import { TASK_DEFAULT_MAX_ATTEMPTS } from "../constants.js";
import { heraLog } from "../logger.js";
import { errorMessage } from "../helpers.js";

export interface CreateLoopInput {
  name?: string;
  mode: LoopMode;
  taskTemplate: LoopTaskTemplate;
  iterate?: { goal?: AcceptanceCheck[]; maxIterations?: number; feedForward?: boolean };
  recurring?: { intervalMs: number; maxRuns?: number };
  watch?: { condition: AcceptanceCheck[] };
  drain?: { batchId?: string };
}

export interface LoopManagerOptions {
  tickMs: number;
  defaultMaxIterations: number;
  minIntervalMs: number;
  maxConsecutiveFailures: number;
}

export class LoopManager {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(
    private loopStore: LoopStore,
    private taskStore: TaskStore,
    private evaluator: AcceptanceEvaluator,
    private cwd: string,
    private options: LoopManagerOptions,
    private clock: () => number = () => Date.now()
  ) {}

  async createLoop(
    input: CreateLoopInput
  ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const t = input.taskTemplate;
    if (!t || !t.goal || t.goal.trim().length === 0) {
      return { ok: false, error: "taskTemplate.goal is required" };
    }
    if (!Array.isArray(t.acceptance) || t.acceptance.length === 0) {
      return {
        ok: false,
        error: "taskTemplate.acceptance must be non-empty (spawned tasks must be verifiable)",
      };
    }
    const now = this.clock();
    const loop: LoopDefinition = {
      id: randomUUID(),
      name: input.name,
      mode: input.mode,
      status: "active",
      taskTemplate: { ...t, executor: t.executor || "hera" },
      iterations: 0,
      createdAt: now,
      updatedAt: now,
    };

    switch (input.mode) {
      case "iterate":
        loop.iterate = {
          goal: input.iterate?.goal,
          maxIterations: input.iterate?.maxIterations ?? this.options.defaultMaxIterations,
          feedForward: input.iterate?.feedForward ?? false,
        };
        if (loop.iterate.goal && loop.iterate.goal.length === 0) {
          return { ok: false, error: "iterate.goal, when provided, must be non-empty" };
        }
        break;
      case "recurring": {
        const interval = input.recurring?.intervalMs;
        if (interval == null || interval <= 0)
          return { ok: false, error: "recurring.intervalMs is required" };
        const clamped = Math.max(interval, this.options.minIntervalMs);
        loop.recurring = {
          intervalMs: clamped,
          nextRunAt: now + clamped,
          maxRuns: input.recurring?.maxRuns,
          runs: 0,
        };
        break;
      }
      case "watch":
        if (
          !input.watch ||
          !Array.isArray(input.watch.condition) ||
          input.watch.condition.length === 0
        ) {
          return { ok: false, error: "watch.condition must be non-empty" };
        }
        loop.watch = { condition: input.watch.condition, lastConditionMet: false };
        break;
      case "drain":
        loop.drain = { batchId: input.drain?.batchId };
        break;
      default:
        return { ok: false, error: `unknown loop mode: ${String(input.mode)}` };
    }

    await this.loopStore.save(loop);
    heraLog("info", `Created loop ${loop.id} (${loop.mode})`);
    return { ok: true, id: loop.id };
  }

  async pause(id: string): Promise<boolean> {
    const loop = await this.loopStore.get(id);
    if (!loop || loop.status !== "active") return false;
    await this.loopStore.save({ ...loop, status: "paused", updatedAt: this.clock() });
    return true;
  }

  async resume(id: string): Promise<boolean> {
    const loop = await this.loopStore.get(id);
    if (!loop || loop.status !== "paused") return false;
    await this.loopStore.save({ ...loop, status: "active", updatedAt: this.clock() });
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const loop = await this.loopStore.get(id);
    if (!loop || loop.status === "completed" || loop.status === "cancelled") return false;
    const now = this.clock();
    if (loop.currentTaskId) {
      const task = await this.taskStore.get(loop.currentTaskId);
      if (task && (task.status === "pending" || task.status === "running")) {
        await this.taskStore.save({ ...task, status: "cancelled", updatedAt: now });
      }
    }
    await this.loopStore.save({ ...loop, status: "cancelled", updatedAt: now });
    return true;
  }

  async get(id: string): Promise<LoopDefinition | null> {
    return this.loopStore.get(id);
  }

  async list(status?: LoopStatus): Promise<LoopDefinition[]> {
    return status ? this.loopStore.byStatus(status) : this.loopStore.all();
  }

  async tick(now: number): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const loop of this.loopStore.byStatus("active")) {
        try {
          await this.advance(loop, now);
        } catch (err) {
          await this.loopStore.save({ ...loop, lastError: errorMessage(err), updatedAt: now });
          heraLog("warn", `Loop tick error: ${loop.id}`, err);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async recover(): Promise<number> {
    const active = this.loopStore.byStatus("active").length;
    if (active > 0) heraLog("info", `LoopManager recovered ${active} active loop(s)`);
    return active;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick(this.clock());
    }, this.options.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async advance(loop: LoopDefinition, now: number): Promise<void> {
    const terminal = this.taskStore
      .byBatch(loop.id)
      .filter((t) => t.status === "failed" || t.status === "succeeded")
      .sort((a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt));
    let trailing = 0;
    for (let i = terminal.length - 1; i >= 0; i--) {
      if (terminal[i].status === "failed") trailing++;
      else break;
    }
    if (trailing >= this.options.maxConsecutiveFailures) {
      await this.loopStore.save({
        ...loop,
        status: "failed",
        lastError: `loop circuit-breaker: ${trailing} consecutive task failures`,
        updatedAt: now,
      });
      return;
    }

    switch (loop.mode) {
      case "iterate":
        return this.tickIterate(loop, now);
      case "recurring":
        return this.tickRecurring(loop, now);
      case "watch":
        return this.tickWatch(loop, now);
      case "drain":
        return this.tickDrain(loop, now);
    }
  }

  private async enqueueFromTemplate(
    loop: LoopDefinition,
    now: number,
    input?: unknown
  ): Promise<string> {
    const t = loop.taskTemplate;
    const task: TaskRecord = {
      id: randomUUID(),
      batchId: loop.id,
      goal: t.goal,
      executor: t.executor,
      input: input !== undefined ? input : t.input,
      acceptance: t.acceptance,
      status: "pending",
      attempts: 0,
      maxAttempts: t.maxAttempts ?? TASK_DEFAULT_MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    };
    await this.taskStore.save(task);
    return task.id;
  }

  private async tickDrain(loop: LoopDefinition, now: number): Promise<void> {
    const scope = loop.drain?.batchId
      ? this.taskStore.byBatch(loop.drain.batchId)
      : await this.taskStore.all();
    const busy = scope.some((t) => t.status === "pending" || t.status === "running");
    if (!busy) {
      await this.loopStore.save({ ...loop, status: "completed", updatedAt: now });
    }
  }

  private async tickIterate(loop: LoopDefinition, now: number): Promise<void> {
    const cfg = loop.iterate;
    if (!cfg) return;

    const last = loop.currentTaskId ? await this.taskStore.get(loop.currentTaskId) : null;

    // An iteration is in flight: wait.
    if (last && (last.status === "pending" || last.status === "running")) return;

    // Evaluate the goal against the last completed task (if any).
    let goalMet = false;
    if (last) {
      if (cfg.goal && cfg.goal.length > 0) {
        const proof = await this.evaluator.evaluate(
          cfg.goal,
          { output: last.output ?? "", cwd: this.cwd },
          now
        );
        goalMet = this.evaluator.allPassed(proof);
      } else {
        goalMet = last.status === "succeeded";
      }
    }

    if (goalMet) {
      await this.loopStore.save({ ...loop, status: "completed", updatedAt: now });
      return;
    }

    if (loop.iterations >= cfg.maxIterations) {
      await this.loopStore.save({
        ...loop,
        status: "failed",
        lastError: "iterate: max iterations reached without meeting goal",
        updatedAt: now,
      });
      return;
    }

    let input: unknown = loop.taskTemplate.input;
    if (cfg.feedForward && last) {
      input = {
        previousOutput: last.output,
        previousError: last.lastError,
        original: loop.taskTemplate.input,
      };
    }
    const taskId = await this.enqueueFromTemplate(loop, now, input);
    await this.loopStore.save({
      ...loop,
      currentTaskId: taskId,
      iterations: loop.iterations + 1,
      updatedAt: now,
    });
  }
  private async tickRecurring(loop: LoopDefinition, now: number): Promise<void> {
    const cfg = loop.recurring;
    if (!cfg) return;
    if (now < cfg.nextRunAt) return;

    const taskId = await this.enqueueFromTemplate(loop, now);
    const runs = cfg.runs + 1;
    // Fixed cadence; if a full interval still lands in the past, skip missed runs.
    const advanced = cfg.nextRunAt + cfg.intervalMs;
    const nextRunAt = advanced <= now ? now + cfg.intervalMs : advanced;
    const completed = cfg.maxRuns != null && runs >= cfg.maxRuns;
    await this.loopStore.save({
      ...loop,
      recurring: { ...cfg, runs, nextRunAt },
      currentTaskId: taskId,
      iterations: loop.iterations + 1,
      status: completed ? "completed" : loop.status,
      updatedAt: now,
    });
  }
  private async tickWatch(loop: LoopDefinition, now: number): Promise<void> {
    const cfg = loop.watch;
    if (!cfg) return;
    const proof = await this.evaluator.evaluate(cfg.condition, { output: "", cwd: this.cwd }, now);
    const met = this.evaluator.allPassed(proof);

    let iterations = loop.iterations;
    let currentTaskId = loop.currentTaskId;
    if (met && !cfg.lastConditionMet) {
      currentTaskId = await this.enqueueFromTemplate(loop, now);
      iterations += 1;
    }
    await this.loopStore.save({
      ...loop,
      watch: { ...cfg, lastConditionMet: met },
      currentTaskId,
      iterations,
      updatedAt: now,
    });
  }
}
