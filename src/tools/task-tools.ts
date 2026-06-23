// src/tools/task-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type { AcceptanceCheck, TaskRecord, TaskStatus } from "../engine/task-types.js";
import { TASK_DEFAULT_MAX_ATTEMPTS, TASK_DEFAULT_BACKOFF_MS } from "../constants.js";
import { randomUUID } from "node:crypto";

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
  if (!Array.isArray(input.acceptance) || input.acceptance.length === 0) {
    return "Error: at least one acceptance check is required (a task with no acceptance check cannot be verified complete).";
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
          .array(z.any())
          .describe("Acceptance checks (shell/file_exists/regex); ALL must pass. Required, non-empty."),
        maxAttempts: z.number().optional().describe("Retry budget (default from config)"),
        dependsOn: z.array(z.string()).optional().describe("Task ids that must succeed first"),
      },
      async execute(args) {
        const input = args as unknown as EnqueueInput;
        const err = validateEnqueue(input);
        if (err) return err;
        const task = buildTask(input, undefined, Date.now());
        await taskStore.save(task);
        return `Task enqueued: ${task.id}`;
      },
    }),

    hera_enqueue_batch: tool({
      description: "Enqueue many durable tasks at once under one batch id (supports large batches).",
      args: {
        tasks: z.array(z.any()).describe("Array of task definitions (same shape as hera_enqueue_task)"),
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
        for (const t of tasks) await taskStore.save(buildTask(t, batchId, now));
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
          task.proof ? `Proof: ${JSON.stringify(task.proof)}` : "",
        ].filter(Boolean).join("\n");
      },
    }),

    hera_list_tasks: tool({
      description: "List tasks, optionally filtered by status.",
      args: { status: z.string().optional().describe("pending|running|succeeded|failed|cancelled") },
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
      description: "Final accounting for a batch: succeeded count, failed list with reasons, and in-flight counts. Never reports partial success as complete.",
      args: { batchId: z.string().describe("Batch id") },
      async execute(args) {
        const tasks = taskStore.byBatch(args.batchId);
        if (tasks.length === 0) return `No tasks in batch ${args.batchId}.`;
        const by = (s: TaskStatus) => tasks.filter((t) => t.status === s);
        const failed = by("failed");
        const complete = failed.length === 0 && by("pending").length === 0 && by("running").length === 0 && by("cancelled").length === 0;
        return [
          `Batch ${args.batchId}: ${by("succeeded").length} succeeded, ${failed.length} failed, ${by("running").length} running, ${by("pending").length} pending, ${by("cancelled").length} cancelled (of ${tasks.length}).`,
          complete ? "Batch fully complete." : "Batch NOT fully complete.",
          ...failed.map((t) => `  FAILED ${t.id}: ${t.lastError ?? "unknown"}`),
        ].join("\n");
      },
    }),
  };
}
