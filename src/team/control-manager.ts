import { randomUUID } from "node:crypto";

export interface ControlPoint {
  id: string;
  name: string;
  type: "checkpoint" | "gate" | "feedback";
  condition: string;
  action: "approve" | "reject" | "escalate";
  reviewer?: string;
  status?: "pending" | "passed" | "failed";
}

/**
 * Create a new control point with generated ID.
 */
export function createControlPoint(
  name: string,
  type: ControlPoint["type"],
  condition: string,
  action: ControlPoint["action"],
  reviewer?: string,
): ControlPoint {
  return {
    id: `cp-${randomUUID().slice(0, 8)}`,
    name,
    type,
    condition,
    action,
    reviewer,
    status: "pending",
  };
}

/**
 * Add a control point to the list. Returns new array (immutable).
 */
export function addControlPoint(
  points: ControlPoint[],
  point: ControlPoint,
): ControlPoint[] {
  const exists = points.some((p) => p.name === point.name && p.type === point.type);
  if (exists) {
    throw new Error(`Control point "${point.name}" (${point.type}) already exists.`);
  }
  return [...points, point];
}

/**
 * Remove a control point by ID. Returns new array (immutable).
 */
export function removeControlPoint(
  points: ControlPoint[],
  pointId: string,
): ControlPoint[] {
  return points.filter((p) => p.id !== pointId);
}

/**
 * Evaluate a control point against a context object.
 * Simple condition evaluation: checks if condition string matches keys in context.
 */
export function evaluateControlPoint(
  point: ControlPoint,
  context: Record<string, unknown>,
): ControlPoint {
  if (point.status !== "pending") return point;

  try {
    const result = evaluateCondition(point.condition, context);
    return {
      ...point,
      status: result ? "passed" : "failed",
    };
  } catch {
    return { ...point, status: "failed" };
  }
}

/**
 * Escalate a control point to another agent.
 */
export function escalate(
  point: ControlPoint,
  toAgent: string,
): ControlPoint {
  return {
    ...point,
    action: "escalate",
    reviewer: toAgent,
    status: "pending",
  };
}

/**
 * Get all pending control points.
 */
export function getPendingPoints(points: ControlPoint[]): ControlPoint[] {
  return points.filter((p) => p.status === "pending");
}

/**
 * Get all failed control points.
 */
export function getFailedPoints(points: ControlPoint[]): ControlPoint[] {
  return points.filter((p) => p.status === "failed");
}

/**
 * Format a control point for display.
 */
export function formatControlPoint(point: ControlPoint): string {
  const statusIcon = point.status === "passed" ? "✅" : point.status === "failed" ? "❌" : "⏳";
  return `${statusIcon} **${point.name}** (${point.type}) — Condition: "${point.condition}" → ${point.action}${point.reviewer ? ` → Reviewer: ${point.reviewer}` : ""} [${point.status ?? "pending"}]`;
}

/**
 * Format all control points for display.
 */
export function formatControlPoints(points: ControlPoint[]): string {
  if (points.length === 0) return "No control points defined.";
  return points.map(formatControlPoint).join("\n");
}

/**
 * Simple condition evaluator.
 * Supports: "key=value", "key>value", "key<value", "key" (truthy check).
 */
function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  const trimmed = condition.trim();

  // key=value
  if (trimmed.includes("==")) {
    const [key, val] = trimmed.split("==").map((s) => s.trim());
    return String(context[key]) === val;
  }

  // key>value (numeric)
  if (trimmed.includes(">")) {
    const [key, val] = trimmed.split(">").map((s) => s.trim());
    const ctxVal = Number(context[key]);
    const target = Number(val);
    if (isNaN(ctxVal) || isNaN(target)) return false;
    return ctxVal > target;
  }

  // key<value (numeric)
  if (trimmed.includes("<")) {
    const [key, val] = trimmed.split("<").map((s) => s.trim());
    const ctxVal = Number(context[key]);
    const target = Number(val);
    if (isNaN(ctxVal) || isNaN(target)) return false;
    return ctxVal < target;
  }

  // key>=value
  if (trimmed.includes(">=")) {
    const [key, val] = trimmed.split(">=").map((s) => s.trim());
    const ctxVal = Number(context[key]);
    const target = Number(val);
    if (isNaN(ctxVal) || isNaN(target)) return false;
    return ctxVal >= target;
  }

  // key<=value
  if (trimmed.includes("<=")) {
    const [key, val] = trimmed.split("<=").map((s) => s.trim());
    const ctxVal = Number(context[key]);
    const target = Number(val);
    if (isNaN(ctxVal) || isNaN(target)) return false;
    return ctxVal <= target;
  }

  // truthy check
  return Boolean(context[trimmed]);
}
