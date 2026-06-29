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
