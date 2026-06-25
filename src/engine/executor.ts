// src/engine/executor.ts
import type { TaskStore } from "./task-store.js";
import type { AcceptanceEvaluator } from "./acceptance.js";
import type { TaskRecord } from "./task-types.js";
import { heraLog } from "../logger.js";

export interface AgentRunner {
  run(executor: string, prompt: string): Promise<string>;
}

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`attempt timed out after ${ms}ms`)), ms);
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

  async runAttempt(task: TaskRecord, now: number): Promise<TaskRecord> {
    const prompt = this.buildPrompt(task);
    let output = "";
    let agentError: string | undefined;
    try {
      output = await raceWithTimeout(this.runner.run(task.executor, prompt), this.attemptTimeoutMs);
    } catch (err) {
      agentError = err instanceof Error ? err.message : String(err);
    }

    if (agentError) {
      return this.fail(task, now, `agent error: ${agentError}`);
    }

    const proof = await this.evaluator.evaluate(task.acceptance, { output, cwd: this.cwd }, now);
    if (this.evaluator.allPassed(proof)) {
      const succeeded: TaskRecord = {
        ...task,
        status: "succeeded",
        attempts: task.attempts + 1,
        proof,
        output,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
        completedAt: now,
      };
      await this.store.save(succeeded);
      heraLog("info", `Task succeeded: ${task.id}`);
      return succeeded;
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
    const attempts = task.attempts + 1;
    const exhausted = attempts >= task.maxAttempts;
    const updated: TaskRecord = {
      ...task,
      status: exhausted ? "failed" : "pending",
      attempts,
      proof: proof ?? task.proof,
      output: output ?? task.output,
      lastError: reason,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
      completedAt: exhausted ? now : undefined,
    };
    await this.store.save(updated);
    heraLog(exhausted ? "warn" : "debug", `Task ${updated.status}: ${task.id} (${reason})`);
    return updated;
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
