// src/tools/loop-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type { AcceptanceCheck } from "../engine/task-types.js";
import type { LoopMode } from "../engine/loop-types.js";

const z = tool.schema;

export function createLoopTools(ctx: PluginContext) {
  const { loopManager } = ctx;
  return {
    hera_create_loop: tool({
      description:
        "Create a durable loop that enqueues tasks over time. Modes: iterate (until goal), recurring (fixed interval), watch (on condition edge), drain (until queue empties). The loop's tasks complete only when their acceptance checks pass.",
      args: {
        mode: z.enum(["iterate", "recurring", "watch", "drain"]).describe("Loop mode"),
        goal: z.string().describe("Task goal the loop enqueues"),
        executor: z.string().optional().describe("Agent to run each task (default: hera)"),
        acceptance: z.array(z.any()).describe("Task acceptance checks (required, non-empty)"),
        maxAttempts: z.number().optional().describe("Per-task retry budget"),
        maxIterations: z.number().optional().describe("iterate: cap on iterations"),
        feedForward: z
          .boolean()
          .optional()
          .describe("iterate: feed prior output into the next task"),
        iterateGoal: z
          .array(z.any())
          .optional()
          .describe("iterate: optional loop-level goal checks"),
        intervalMs: z
          .number()
          .optional()
          .describe("recurring: interval in ms (floored to the minimum)"),
        maxRuns: z.number().optional().describe("recurring: stop after this many runs"),
        condition: z.array(z.any()).optional().describe("watch: condition checks (edge-triggered)"),
        batchId: z.string().optional().describe("drain: scope to a specific batch id"),
      },
      async execute(args) {
        const a = args as Record<string, unknown>;
        const res = await loopManager.createLoop({
          mode: a.mode as LoopMode,
          taskTemplate: {
            goal: a.goal as string,
            executor: (a.executor as string) || "hera",
            acceptance: (a.acceptance as AcceptanceCheck[]) ?? [],
            maxAttempts: a.maxAttempts as number | undefined,
          },
          iterate:
            a.mode === "iterate"
              ? {
                  goal: a.iterateGoal as AcceptanceCheck[] | undefined,
                  maxIterations: a.maxIterations as number | undefined,
                  feedForward: a.feedForward as boolean | undefined,
                }
              : undefined,
          recurring:
            a.mode === "recurring"
              ? { intervalMs: a.intervalMs as number, maxRuns: a.maxRuns as number | undefined }
              : undefined,
          watch:
            a.mode === "watch"
              ? { condition: (a.condition as AcceptanceCheck[]) ?? [] }
              : undefined,
          drain: a.mode === "drain" ? { batchId: a.batchId as string | undefined } : undefined,
        });
        if (!res.ok) return `Error: ${res.error}`;
        return `Loop created: loop ${res.id} (${a.mode})`;
      },
    }),

    hera_list_loops: tool({
      description: "List loops, optionally filtered by status.",
      args: { status: z.string().optional().describe("active|paused|completed|cancelled|failed") },
      async execute(args) {
        const loops = await loopManager.list(args.status as never);
        if (loops.length === 0) return "No loops.";
        return loops
          .map((l) => `- ${l.id} [${l.mode}/${l.status}] iterations=${l.iterations}`)
          .join("\n");
      },
    }),

    hera_loop_status: tool({
      description: "Show a loop's mode, status, iterations, current task, and last error.",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        const loop = await loopManager.get(args.id);
        if (!loop) return `No loop found: ${args.id}`;
        return [
          `Loop ${loop.id}: ${loop.mode}/${loop.status} (iterations ${loop.iterations})`,
          loop.currentTaskId ? `Current task: ${loop.currentTaskId}` : "",
          loop.lastError ? `Last error: ${loop.lastError}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
    }),

    hera_pause_loop: tool({
      description: "Pause an active loop.",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        return (await loopManager.pause(args.id))
          ? `Loop paused: ${args.id}`
          : `Could not pause loop: ${args.id}`;
      },
    }),

    hera_resume_loop: tool({
      description: "Resume a paused loop.",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        return (await loopManager.resume(args.id))
          ? `Loop resumed: ${args.id}`
          : `Could not resume loop: ${args.id}`;
      },
    }),

    hera_cancel_loop: tool({
      description: "Cancel a loop (and its in-flight task, if any).",
      args: { id: z.string().describe("Loop id") },
      async execute(args) {
        return (await loopManager.cancel(args.id))
          ? `Loop cancelled: ${args.id}`
          : `Could not cancel loop: ${args.id}`;
      },
    }),
  };
}
