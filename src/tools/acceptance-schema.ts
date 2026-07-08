// src/tools/acceptance-schema.ts
// Shared strict schema + validator for AcceptanceCheck arrays, used by BOTH the
// task enqueue tools and the loop tool so a loop cannot accept a malformed
// acceptance check that hera_enqueue_task would reject.
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

export const acceptanceCheckSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("shell"),
    command: z.string().min(1),
    cwd: z.string().optional(),
    expectExit: z.number().optional(),
    timeoutMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("file_exists"),
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal("regex"),
    source: z.enum(["output", "file"]),
    path: z.string().optional(),
    pattern: z.string().min(1),
  }),
  z.object({
    type: z.literal("llm_judge"),
    rubric: z.string().min(1),
    threshold: z.number().optional(),
  }),
]);

/**
 * Validate an acceptance-check array. Returns null when valid, or a human-readable
 * error string naming the offending index. A regex check with source:"file" must
 * carry a path (otherwise it is permanently unsatisfiable).
 */
export function validateAcceptanceChecks(checks: unknown): string | null {
  if (!Array.isArray(checks) || checks.length === 0) {
    return "at least one acceptance check is required (a task with no acceptance check cannot be verified complete).";
  }
  for (let i = 0; i < checks.length; i++) {
    const parsed = acceptanceCheckSchema.safeParse(checks[i]);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((iss) => iss.message).join("; ") || "invalid shape";
      return `acceptance check #${i} is malformed (${reason}). Expected one of shell/file_exists/regex/llm_judge.`;
    }
    const c = parsed.data as { type: string; source?: string; path?: string };
    if (c.type === "regex" && c.source === "file" && !c.path) {
      return `acceptance check #${i}: a regex check with source "file" requires a "path".`;
    }
  }
  return null;
}

/**
 * Validate a WATCH-loop condition. Same base rules as acceptance, plus: a watch
 * condition is evaluated against empty output (there is no prior task output to
 * read), so checks that read `output` are permanently unsatisfiable and are
 * rejected here rather than silently spinning the loop forever.
 */
export function validateWatchCondition(checks: unknown): string | null {
  const base = validateAcceptanceChecks(checks);
  if (base) return base;
  const arr = checks as Array<{ type?: string; source?: string }>;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c.type === "regex" && c.source === "output") {
      return `watch condition #${i}: a regex check with source "output" can never match — a watch condition sees no task output. Use source "file" (with a path), or a shell/file_exists check.`;
    }
    if (c.type === "llm_judge") {
      return `watch condition #${i}: llm_judge is not a valid watch condition (it would judge empty output). Use shell/file_exists, or a regex on a file.`;
    }
  }
  return null;
}
