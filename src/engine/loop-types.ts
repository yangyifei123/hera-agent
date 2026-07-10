// src/engine/loop-types.ts
import type { AcceptanceCheck } from "./task-types.js";

export type LoopMode = "iterate" | "recurring" | "watch" | "drain";
export type LoopStatus = "active" | "paused" | "completed" | "cancelled" | "failed";

export interface LoopTaskTemplate {
  goal: string;
  executor: string;
  acceptance: AcceptanceCheck[];
  maxAttempts?: number;
  input?: unknown;
}

export interface LoopDefinition {
  id: string;
  name?: string;
  mode: LoopMode;
  status: LoopStatus;
  taskTemplate: LoopTaskTemplate;
  iterate?: { goal?: AcceptanceCheck[]; maxIterations: number; feedForward?: boolean };
  recurring?: { intervalMs: number; nextRunAt: number; maxRuns?: number; runs: number };
  watch?: { condition: AcceptanceCheck[]; lastConditionMet: boolean };
  drain?: { batchId?: string };
  iterations: number;
  currentTaskId?: string;
  lastError?: string;
  // Cross-process firing lease (mirrors TaskRecord.leaseOwner/leaseExpiresAt).
  // The process that owns a live lease owns this loop's firing; a second
  // OpenCode process sharing the same data dir sees the lease on disk and backs
  // off so the loop is never ticked (and so double-enqueued) from two processes.
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}
