import { randomUUID } from "node:crypto";

export interface KeyResult {
  id: string;
  description: string;
  target: number;
  current: number;
  metric: string;
}

export interface OKRObjective {
  id: string;
  name: string;
  keyResults: KeyResult[];
  assignee?: string;
  deadline?: number;
}

/**
 * Create a new OKR objective with generated ID.
 */
export function createObjective(
  name: string,
  keyResults: KeyResult[],
  assignee?: string,
  deadline?: number
): OKRObjective {
  return {
    id: `obj-${randomUUID().slice(0, 8)}`,
    name,
    keyResults,
    assignee,
    deadline,
  };
}

/**
 * Create a key result with generated ID.
 */
export function createKeyResult(
  description: string,
  target: number,
  metric: string,
  current: number = 0
): KeyResult {
  return {
    id: `kr-${randomUUID().slice(0, 8)}`,
    description,
    target,
    current,
    metric,
  };
}

/**
 * Update a key result's progress by ID. Returns new objective (immutable).
 */
export function updateKeyResult(
  objective: OKRObjective,
  krId: string,
  progress: number
): OKRObjective {
  const krIndex = objective.keyResults.findIndex((kr) => kr.id === krId);
  if (krIndex === -1) {
    throw new Error(`Key result "${krId}" not found in objective "${objective.name}".`);
  }
  const updatedKeyResults = objective.keyResults.map((kr, i) =>
    // For a drive-to-zero KR (target 0) `current` is the remaining count, so it
    // must not be capped at the target (Math.min(x,0)=0 froze it at 0%). For a
    // positive target, cap at the target as before.
    i === krIndex
      ? { ...kr, current: kr.target === 0 ? Math.max(0, progress) : Math.min(progress, kr.target) }
      : kr
  );
  return { ...objective, keyResults: updatedKeyResults };
}

/** Completion percent of a single key result, supporting drive-to-zero (target 0). */
function keyResultPercent(kr: { current: number; target: number }): number {
  if (kr.target === 0) return kr.current <= 0 ? 100 : 0;
  return (kr.current / kr.target) * 100;
}

/**
 * Calculate progress of a single objective (0-100).
 * Weighted average of key result completion percentages.
 */
export function calculateProgress(objective: OKRObjective): number {
  if (objective.keyResults.length === 0) return 0;
  const total = objective.keyResults.reduce((sum, kr) => {
    return sum + Math.min(keyResultPercent(kr), 100);
  }, 0);
  return Math.round(total / objective.keyResults.length);
}

/**
 * Calculate overall team progress across all objectives (0-100).
 */
export function calculateTeamProgress(objectives: OKRObjective[]): number {
  if (objectives.length === 0) return 0;
  const total = objectives.reduce((sum, obj) => sum + calculateProgress(obj), 0);
  return Math.round(total / objectives.length);
}

/**
 * Format an objective for display.
 */
export function formatObjective(obj: OKRObjective): string {
  const progress = calculateProgress(obj);
  const krLines = obj.keyResults.map((kr) => {
    const pct = Math.round(Math.min(keyResultPercent(kr), 100));
    return `  - ${kr.description}: ${kr.current}/${kr.target} ${kr.metric} (${pct}%)`;
  });
  return [
    `**${obj.name}** (${progress}%)${obj.assignee ? ` → ${obj.assignee}` : ""}`,
    ...krLines,
  ].join("\n");
}

/**
 * Format all objectives for team progress display.
 */
export function formatTeamProgress(objectives: OKRObjective[]): string {
  if (objectives.length === 0) return "No objectives defined.";
  const overall = calculateTeamProgress(objectives);
  const lines = objectives.map(formatObjective);
  return [`Overall Progress: **${overall}%**`, "", ...lines].join("\n");
}
