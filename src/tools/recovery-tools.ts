// src/tools/recovery-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import type { TaskStatus } from "../engine/task-types.js";

export function createRecoveryTools(ctx: PluginContext) {
  const { taskStore, supervisor, loopManager, teamManager } = ctx;
  return {
    hera_recover: tool({
      description: "Reclaim orphaned tasks: reset expired-lease 'running' tasks back to 'pending' so they re-run.",
      args: {},
      async execute() {
        const count = await taskStore.recover(Date.now());
        return `Recovered ${count} orphaned task(s) (reset to pending).`;
      },
    }),

    hera_engine_health: tool({
      description: "Report task-engine and loop-engine health: task counts by status, loop counts by status, and supervisor stats.",
      args: {},
      async execute() {
        const statuses: TaskStatus[] = ["pending", "running", "succeeded", "failed", "cancelled"];
        const taskLine = statuses.map((s) => `${s}=${taskStore.byStatus(s).length}`).join(" ");
        const loops = await loopManager.list();
        const loopCounts = loops.reduce<Record<string, number>>((acc, l) => {
          acc[l.status] = (acc[l.status] ?? 0) + 1;
          return acc;
        }, {});
        const loopLine = Object.entries(loopCounts).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
        const s = supervisor.stats();
        return [
          `Tasks: ${taskLine}`,
          `Loops: ${loopLine}`,
          `Supervisor: active=${s.active} reclaimed=${s.reclaimed} concurrency=${s.concurrency}`,
        ].join("\n");
      },
    }),

    hera_recover_sessions: tool({
      description: "Reconcile crashed/unknown team sessions by re-polling their status.",
      args: {},
      async execute() {
        const count = await teamManager.recoverSessions();
        return `Reconciled ${count} team session(s).`;
      },
    }),
  };
}
