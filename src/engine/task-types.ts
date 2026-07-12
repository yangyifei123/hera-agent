// src/engine/task-types.ts
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface RubricCriterion {
  id?: string;
  requirement: string;
  weight?: number; // default 1 (applied at normalization, not here)
  critical?: boolean; // median must independently meet threshold
}

export interface EvidenceSpec {
  files: string[];
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export interface CriterionVerdict {
  id: string;
  requirement: string;
  weight: number;
  critical: boolean;
  score: number; // median across valid samples, clamped [0,1]
  reasoning: string;
}

export interface JudgeVerdictRecord {
  criteria: CriterionVerdict[];
  overallScore: number;
  pass: boolean;
  samples: number;
  aggregation: "single" | "median";
  judgeAgent: string;
  elapsedMs: number;
}

export type AcceptanceCheck =
  | { type: "shell"; command: string; cwd?: string; expectExit?: number; timeoutMs?: number }
  | { type: "file_exists"; path: string }
  | { type: "regex"; source: "output" | "file"; path?: string; pattern: string }
  // Semantic completion gate: an LLM judge scores the task output against a
  // rubric (a plain string, or analytic criteria with weights/critical flags)
  // and the weighted total (0-1) must meet threshold. Defends against
  // perfunctory completion that trivially passes presence checks. Requires a
  // judge to be configured.
  | {
      type: "llm_judge";
      rubric: string | RubricCriterion[];
      threshold?: number;
      samples?: number;
      evidence?: EvidenceSpec;
    };

export interface AcceptanceResult {
  check: AcceptanceCheck;
  passed: boolean;
  detail?: string;
  verdict?: JudgeVerdictRecord;
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
  /** Earliest time this pending task may be re-claimed (retry backoff gate). */
  nextEligibleAt?: number;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  completedAt?: number;
}
