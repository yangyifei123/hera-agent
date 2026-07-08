import type { DriveMode } from "./types.js";
import type { SessionCtx } from "../types.js";

const AUTO_ADDENDUM = [
  "## Drive mode: auto (AI-led)",
  "",
  "You are running in AUTONOMOUS drive mode. Treat the user's latest message as a",
  "goal plus bounds plus process, not a turn in a conversation. Minimize",
  "back-and-forth: do not ask clarifying questions unless a required bound is",
  "missing and blocks all progress. Drive the work through the durable engine —",
  "enqueue background work with hera_enqueue_task and create recurring/iterating",
  "work with hera_create_loop — rather than doing it inline turn by turn. Report",
  "only when the work is complete or genuinely blocked.",
].join("\n");

/**
 * Mode-specific text appended to Hera's system prompt.
 * - collab  -> null (today's behavior, no addendum).
 * - auto    -> the autonomy directive.
 * - program -> null (a program run executes in Spec 2's child process, not
 *              through a Hera chat turn, so there is no prompt to shape).
 *
 * `_ctx` is reserved for future per-directory/per-session addenda; unused today.
 */
export function driveModeSystemAddendum(mode: DriveMode, _ctx: SessionCtx): string | null {
  if (mode === "auto") return AUTO_ADDENDUM;
  return null;
}
