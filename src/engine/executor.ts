// src/engine/executor.ts
import type { TaskStore } from "./task-store.js";
import type { AcceptanceEvaluator } from "./acceptance.js";
import type { TaskRecord } from "./task-types.js";
import { heraLog } from "../logger.js";

export interface AgentRunner {
  /**
   * Run one attempt. When `signal` aborts (attempt timeout or task cancel), the
   * runner must stop and tear down any underlying session so it does not keep
   * executing orphaned (and conflict with a retry's fresh session).
   */
  run(executor: string, prompt: string, signal?: AbortSignal): Promise<string>;
}

function raceWithTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`attempt timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export class TaskExecutor {
  constructor(
    private store: TaskStore,
    private evaluator: AcceptanceEvaluator,
    private runner: AgentRunner,
    private cwd: string,
    private attemptTimeoutMs: number = 0
  ) {}

  async runAttempt(
    task: TaskRecord,
    now: number,
    externalSignal?: AbortSignal
  ): Promise<TaskRecord> {
    const prompt = this.buildPrompt(task);
    let output = "";
    let agentError: string | undefined;
    // One controller drives runner teardown for both the attempt timeout and an
    // external cancel (supervisor aborts it when the task is cancelled).
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    try {
      output = await raceWithTimeout(
        this.runner.run(task.executor, prompt, controller.signal),
        this.attemptTimeoutMs,
        () => controller.abort()
      );
    } catch (err) {
      agentError = err instanceof Error ? err.message : String(err);
    } finally {
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }

    if (agentError) {
      return this.fail(task, now, `agent error: ${agentError}`);
    }

    const proof = await this.evaluator.evaluate(task.acceptance, { output, cwd: this.cwd }, now);
    if (this.evaluator.allPassed(proof)) {
      const succeeded = await this.commitTerminal(task, (current) => ({
        ...current,
        status: "succeeded",
        attempts: current.attempts + 1,
        proof,
        output,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
        completedAt: now,
      }));
      if (succeeded) heraLog("info", `Task succeeded: ${task.id}`);
      return succeeded ?? { ...task, status: "cancelled" };
    }

    const failedDetail = proof
      .filter((p) => !p.passed)
      .map((p) => p.detail)
      .join("; ");
    return this.fail(task, now, `acceptance failed: ${failedDetail}`, proof, output);
  }

  private async fail(
    task: TaskRecord,
    now: number,
    reason: string,
    proof?: TaskRecord["proof"],
    output?: string
  ): Promise<TaskRecord> {
    const updated = await this.commitTerminal(task, (current) => {
      const attempts = current.attempts + 1;
      const exhausted = attempts >= current.maxAttempts;
      // Exponential retry backoff: a re-queued task waits backoffMs * 2^(attempts-1)
      // before claimReady will lease it again. Without this, failed tasks spin at
      // full tick rate with zero delay.
      const backoff = current.backoffMs ?? 0;
      const nextEligibleAt =
        !exhausted && backoff > 0 ? now + backoff * Math.pow(2, attempts - 1) : undefined;
      return {
        ...current,
        status: exhausted ? "failed" : "pending",
        attempts,
        proof: proof ?? current.proof,
        output: output ?? current.output,
        lastError: reason,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        nextEligibleAt,
        updatedAt: now,
        completedAt: exhausted ? now : undefined,
      };
    });
    if (updated) {
      heraLog(
        updated.status === "failed" ? "warn" : "debug",
        `Task ${updated.status}: ${task.id} (${reason})`
      );
      return updated;
    }
    // The task was cancelled (or reclaimed by another owner) while this attempt
    // was in flight; honor that instead of resurrecting it to pending/failed.
    heraLog("debug", `Task attempt result dropped (no longer owned/running): ${task.id}`);
    return { ...task, status: "cancelled" };
  }

  /**
   * Persist a terminal transition via compare-and-set, refusing to overwrite a
   * record that was cancelled (or re-leased to a different owner) while this
   * attempt was running. Returns the persisted record, or null when the write
   * was intentionally dropped. This is what stops a slow attempt from
   * resurrecting an explicitly cancelled task.
   */
  private async commitTerminal(
    task: TaskRecord,
    build: (current: TaskRecord) => TaskRecord
  ): Promise<TaskRecord | null> {
    let wrote = false;
    const res = await this.store.update(task.id, (current) => {
      if (!current) return undefined;
      if (current.status === "cancelled") return undefined;
      // Another owner reclaimed this task's lease (crash recovery) and may be
      // running it now — don't stomp their record with our stale attempt.
      if (current.leaseOwner !== task.leaseOwner) return undefined;
      wrote = true;
      return build(current);
    });
    // update() returns the current value on abort; return null so callers can
    // tell an applied terminal write from a dropped one.
    return wrote ? res : null;
  }

  private buildPrompt(task: TaskRecord): string {
    const lines = [task.goal];
    if (task.input != null) {
      lines.push(
        "",
        "Input:",
        typeof task.input === "string" ? task.input : JSON.stringify(task.input)
      );
    }
    lines.push(
      "",
      "Acceptance criteria (your work is only complete when these pass):",
      ...task.acceptance.map((c) => `- ${JSON.stringify(c)}`)
    );
    return lines.join("\n");
  }
}
