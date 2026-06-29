// src/engine/active-work.ts
import type { TaskStore } from "./task-store.js";
import type { LoopManager } from "./loop-manager.js";

/**
 * Build a short context block describing live durable work, for injection into
 * a session's retained context across compaction. Returns "" when nothing is
 * live, so callers can append unconditionally.
 */
export async function buildActiveWorkContext(
  taskStore: Pick<TaskStore, "byStatus">,
  loopManager: Pick<LoopManager, "list">
): Promise<string> {
  const pending = taskStore.byStatus("pending").length;
  const running = taskStore.byStatus("running").length;
  const activeLoops = (await loopManager.list("active")).length;
  if (pending === 0 && running === 0 && activeLoops === 0) return "";
  return [
    "## Active durable work",
    `Tasks: ${pending} pending, ${running} running. Loops: ${activeLoops} active.`,
    "These persist across this compaction. Inspect with hera_task_status / hera_loop_status / hera_engine_health.",
  ].join("\n");
}
