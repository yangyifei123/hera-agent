// src/tools/task-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type {
  AcceptanceCheck,
  AcceptanceResult,
  TaskRecord,
  TaskStatus,
} from "../engine/task-types.js";
import {
  TASK_DEFAULT_MAX_ATTEMPTS,
  TASK_DEFAULT_BACKOFF_MS,
  JUDGE_DEFAULT_THRESHOLD,
} from "../constants.js";
import { randomUUID } from "node:crypto";
import { acceptanceCheckSchema, validateAcceptanceChecks } from "./acceptance-schema.js";

const z = tool.schema;

interface EnqueueInput {
  goal: string;
  executor?: string;
  input?: unknown;
  acceptance: AcceptanceCheck[];
  maxAttempts?: number;
  dependsOn?: string[];
}

function validateEnqueue(input: EnqueueInput): string | null {
  if (!input.goal || input.goal.trim().length === 0) return "Error: task goal is required.";
  const err = validateAcceptanceChecks(input.acceptance);
  return err ? `Error: ${err}` : null;
}

/**
 * Ensure every dependency id resolves to a real task. Unknown ids (typos,
 * hallucinated uuids) would otherwise leave the dependent task pending forever,
 * since claimReady only runs a task once all its deps have succeeded.
 */
async function validateDependencies(
  taskStore: PluginContext["taskStore"],
  dependsOn: string[] | undefined
): Promise<string | null> {
  if (!dependsOn || dependsOn.length === 0) return null;
  const missing: string[] = [];
  for (const dep of dependsOn) {
    if (!(await taskStore.get(dep))) missing.push(dep);
  }
  if (missing.length > 0) {
    return `Error: dependsOn references unknown task id(s): ${missing.join(", ")}. Enqueue the dependency first (a dependent task never runs until its deps succeed).`;
  }
  return null;
}

function buildTask(input: EnqueueInput, batchId: string | undefined, now: number): TaskRecord {
  return {
    id: randomUUID(),
    batchId,
    goal: input.goal.trim(),
    executor: input.executor || "hera",
    input: input.input,
    acceptance: input.acceptance,
    status: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? TASK_DEFAULT_MAX_ATTEMPTS,
    backoffMs: TASK_DEFAULT_BACKOFF_MS,
    dependsOn: input.dependsOn,
    createdAt: now,
    updatedAt: now,
  };
}

/** Human-readable proof rendering; per-criterion breakdown for llm_judge verdicts. */
export function formatProof(proof: AcceptanceResult[]): string {
  return proof
    .map((r) => {
      const head = `${r.passed ? "✓" : "✗"} [${r.check.type}] ${r.detail ?? ""}`.trimEnd();
      if (!r.verdict) return head;
      const threshold =
        r.check.type === "llm_judge"
          ? (r.check.threshold ?? JUDGE_DEFAULT_THRESHOLD)
          : JUDGE_DEFAULT_THRESHOLD;
      const lines = r.verdict.criteria.map((c) => {
        const mark = c.score >= threshold ? "✓" : "✗";
        const crit = c.critical ? " (critical)" : "";
        const reason = c.reasoning.split("\n")[0];
        return `  ${mark} ${c.requirement} — ${c.score.toFixed(2)}${crit} — ${reason}`;
      });
      return [head, ...lines].join("\n");
    })
    .join("\n");
}

export function createTaskTools(ctx: PluginContext) {
  const { taskStore } = ctx;
  return {
    hera_enqueue_task: tool({
      description:
        "Enqueue a durable task. The task is complete only when its declarative acceptance checks pass; it retries to budget otherwise.",
      args: {
        goal: z.string().describe("What the task must accomplish"),
        executor: z.string().optional().describe("Agent name to run it (default: hera)"),
        acceptance: z
          .array(acceptanceCheckSchema)
          .describe(
            "Acceptance checks (shell/file_exists/regex/llm_judge); ALL must pass. Required, non-empty. " +
              "llm_judge supports an analytic rubric: [{requirement, weight?, critical?}] plus samples and evidence files."
          ),
        maxAttempts: z.number().optional().describe("Retry budget (default from config)"),
        dependsOn: z.array(z.string()).optional().describe("Task ids that must succeed first"),
      },
      async execute(args) {
        const input = args as unknown as EnqueueInput;
        const err = validateEnqueue(input);
        if (err) return err;
        // Reject dependencies that don't exist: a typo'd/hallucinated id would
        // leave the task 'pending' forever with no error and no path to failure.
        const depErr = await validateDependencies(taskStore, input.dependsOn);
        if (depErr) return depErr;
        const task = buildTask(input, undefined, Date.now());
        await taskStore.save(task);
        return `Task enqueued: ${task.id}`;
      },
    }),

    hera_enqueue_batch: tool({
      description:
        "Enqueue many durable tasks at once under one batch id (supports large batches).",
      args: {
        tasks: z
          .array(z.any())
          .describe("Array of task definitions (same shape as hera_enqueue_task)"),
      },
      async execute(args) {
        const tasks = (args as { tasks: EnqueueInput[] }).tasks;
        if (!Array.isArray(tasks) || tasks.length === 0) return "Error: tasks array is required.";
        for (let i = 0; i < tasks.length; i++) {
          const err = validateEnqueue(tasks[i]);
          if (err) return `Error in task #${i}: ${err}`;
        }
        const batchId = randomUUID();
        const now = Date.now();
        // Two-phase (mirrors the acceptance validation above): validate EVERY
        // task's dependencies before persisting any, so a bad dependency id in a
        // later task cannot leave earlier siblings partially committed (durable
        // and executing) behind an error return. Batch siblings can't reference
        // each other anyway — buildTask assigns a fresh id that is never surfaced
        // to the caller before this handler returns.
        for (let i = 0; i < tasks.length; i++) {
          const depErr = await validateDependencies(taskStore, tasks[i].dependsOn);
          if (depErr) return `Error in task #${i}: ${depErr}`;
        }
        for (let i = 0; i < tasks.length; i++) {
          await taskStore.save(buildTask(tasks[i], batchId, now));
        }
        return `Enqueued ${tasks.length} task(s) in batch ${batchId}`;
      },
    }),

    hera_task_status: tool({
      description: "Get the status, attempts, and acceptance proof for one task.",
      args: { id: z.string().describe("Task id") },
      async execute(args) {
        const task = await taskStore.get(args.id);
        if (!task) return `No task found: ${args.id}`;
        return [
          `Task ${task.id}: ${task.status} (attempt ${task.attempts}/${task.maxAttempts})`,
          task.lastError ? `Last error: ${task.lastError}` : "",
          task.proof ? `Proof:\n${formatProof(task.proof)}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
    }),

    hera_list_tasks: tool({
      description: "List tasks, optionally filtered by status.",
      args: {
        status: z.string().optional().describe("pending|running|succeeded|failed|cancelled"),
      },
      async execute(args) {
        const tasks = args.status
          ? taskStore.byStatus(args.status as TaskStatus)
          : await taskStore.all();
        if (tasks.length === 0) return "No tasks.";
        return tasks.map((t) => `- ${t.id} [${t.status}] ${t.goal}`).join("\n");
      },
    }),

    hera_cancel_task: tool({
      description: "Cancel a task so the supervisor will not run it.",
      args: { id: z.string().describe("Task id") },
      async execute(args) {
        const task = await taskStore.get(args.id);
        if (!task) return `No task found: ${args.id}`;
        if (task.status === "succeeded") return `Task ${args.id} already succeeded.`;
        await taskStore.save({ ...task, status: "cancelled", updatedAt: Date.now() });
        return `Task cancelled: ${args.id}`;
      },
    }),

    hera_batch_report: tool({
      description:
        "Final accounting for a batch: succeeded count, failed list with reasons, and in-flight counts. Never reports partial success as complete.",
      args: { batchId: z.string().describe("Batch id") },
      async execute(args) {
        const tasks = taskStore.byBatch(args.batchId);
        if (tasks.length === 0) return `No tasks in batch ${args.batchId}.`;
        const by = (s: TaskStatus) => tasks.filter((t) => t.status === s);
        const failed = by("failed");
        const complete =
          failed.length === 0 &&
          by("pending").length === 0 &&
          by("running").length === 0 &&
          by("cancelled").length === 0;
        return [
          `Batch ${args.batchId}: ${by("succeeded").length} succeeded, ${failed.length} failed, ${by("running").length} running, ${by("pending").length} pending, ${by("cancelled").length} cancelled (of ${tasks.length}).`,
          complete ? "Batch fully complete." : "Batch NOT fully complete.",
          ...failed.map((t) => `  FAILED ${t.id}: ${t.lastError ?? "unknown"}`),
        ].join("\n");
      },
    }),
  };
}
