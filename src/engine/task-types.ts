// src/engine/task-types.ts
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type AcceptanceCheck =
  | { type: "shell"; command: string; cwd?: string; expectExit?: number; timeoutMs?: number }
  | { type: "file_exists"; path: string }
  | { type: "regex"; source: "output" | "file"; path?: string; pattern: string };

export interface AcceptanceResult {
  check: AcceptanceCheck;
  passed: boolean;
  detail?: string;
  at: number;
}

export interface TaskRecord {
  id: string;
  batchId?: string;
  goal: string;
  executor: string;
  input?: unknown;
  acceptance: AcceptanceCheck[];
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  backoffMs?: number;
  lastError?: string;
  output?: string;
  proof?: AcceptanceResult[];
  dependsOn?: string[];
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  completedAt?: number;
}
