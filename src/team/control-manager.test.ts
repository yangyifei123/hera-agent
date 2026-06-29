import { describe, it, expect } from "bun:test";
import {
  createControlPoint,
  addControlPoint,
  removeControlPoint,
  evaluateControlPoint,
  escalate,
  getPendingPoints,
  getFailedPoints,
  formatControlPoint,
  formatControlPoints,
} from "./control-manager.js";

describe("control-manager", () => {
  describe("createControlPoint", () => {
    it("should create a control point with generated ID", () => {
      const cp = createControlPoint("Code Review", "gate", "coverage>80", "approve", "reviewer");
      expect(cp.id).toMatch(/^cp-/);
      expect(cp.name).toBe("Code Review");
      expect(cp.type).toBe("gate");
      expect(cp.condition).toBe("coverage>80");
      expect(cp.action).toBe("approve");
      expect(cp.reviewer).toBe("reviewer");
      expect(cp.status).toBe("pending");
    });

    it("should create without reviewer", () => {
      const cp = createControlPoint("Test Pass", "checkpoint", "tests_passed", "approve");
      expect(cp.reviewer).toBeUndefined();
    });
  });

  describe("addControlPoint", () => {
    it("should add point to list immutably", () => {
      const cp1 = createControlPoint("CP1", "checkpoint", "x", "approve");
      const cp2 = createControlPoint("CP2", "gate", "y", "reject");
      const result = addControlPoint([cp1], cp2);
      expect(result).toHaveLength(2);
      // Original array unchanged
      expect([cp1]).toHaveLength(1);
    });

    it("should reject duplicate name+type combination", () => {
      const cp = createControlPoint("Review", "gate", "x", "approve");
      const cp2 = { ...cp, id: "different-id" };
      expect(() => addControlPoint([cp], cp2)).toThrow("already exists");
    });

    it("should allow same name with different type", () => {
      const cp1 = createControlPoint("Review", "gate", "x", "approve");
      const cp2 = createControlPoint("Review", "feedback", "y", "reject");
      expect(() => addControlPoint([cp1], cp2)).not.toThrow();
    });
  });

  describe("removeControlPoint", () => {
    it("should remove point by ID", () => {
      const cp1 = createControlPoint("CP1", "checkpoint", "x", "approve");
      const cp2 = createControlPoint("CP2", "gate", "y", "reject");
      const result = removeControlPoint([cp1, cp2], cp1.id);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(cp2.id);
    });

    it("should return same array if ID not found", () => {
      const cp = createControlPoint("CP", "checkpoint", "x", "approve");
      const result = removeControlPoint([cp], "nonexistent");
      expect(result).toHaveLength(1);
    });
  });

  describe("evaluateControlPoint", () => {
    it("should pass when condition is met (equality)", () => {
      const cp = createControlPoint("Env Check", "gate", "environment==production", "approve");
      const result = evaluateControlPoint(cp, { environment: "production" });
      expect(result.status).toBe("passed");
    });

    it("should fail when condition is not met (equality)", () => {
      const cp = createControlPoint("Env Check", "gate", "environment==production", "reject");
      const result = evaluateControlPoint(cp, { environment: "staging" });
      expect(result.status).toBe("failed");
    });

    it("should evaluate greater-than condition", () => {
      const cp = createControlPoint("Coverage", "gate", "coverage>80", "approve");
      const result = evaluateControlPoint(cp, { coverage: 90 });
      expect(result.status).toBe("passed");
    });

    it("should evaluate >= at the boundary (was dead code before operator-order fix)", () => {
      const cp = createControlPoint("Coverage", "gate", "coverage>=80", "approve");
      expect(evaluateControlPoint(cp, { coverage: 80 }).status).toBe("passed");
      expect(evaluateControlPoint(cp, { coverage: 79 }).status).toBe("failed");
    });

    it("should evaluate <= at the boundary", () => {
      const cp = createControlPoint("Errors", "gate", "errors<=0", "approve");
      expect(evaluateControlPoint(cp, { errors: 0 }).status).toBe("passed");
      expect(evaluateControlPoint(cp, { errors: 1 }).status).toBe("failed");
    });

    it("should fail greater-than when value is lower", () => {
      const cp = createControlPoint("Coverage", "gate", "coverage>80", "approve");
      const result = evaluateControlPoint(cp, { coverage: 70 });
      expect(result.status).toBe("failed");
    });

    it("should evaluate less-than condition", () => {
      const cp = createControlPoint("Errors", "checkpoint", "error_count<5", "approve");
      const result = evaluateControlPoint(cp, { error_count: 3 });
      expect(result.status).toBe("passed");
    });

    it("should evaluate truthy check", () => {
      const cp = createControlPoint("Tests", "checkpoint", "all_tests_passed", "approve");
      const result = evaluateControlPoint(cp, { all_tests_passed: true });
      expect(result.status).toBe("passed");
    });

    it("should not re-evaluate non-pending points", () => {
      const cp = {
        ...createControlPoint("Done", "gate", "x==1", "approve"),
        status: "passed" as const,
      };
      const result = evaluateControlPoint(cp, { x: 999 });
      // Should remain passed (not re-evaluated)
      expect(result.status).toBe("passed");
    });

    it("should handle missing context keys gracefully", () => {
      const cp = createControlPoint("Missing", "gate", "nonexistent==true", "reject");
      const result = evaluateControlPoint(cp, {});
      expect(result.status).toBe("failed");
    });
  });

  describe("escalate", () => {
    it("should set action to escalate and assign reviewer", () => {
      const cp = createControlPoint("Deploy Gate", "gate", "tests_passed", "approve");
      const escalated = escalate(cp, "senior-dev");
      expect(escalated.action).toBe("escalate");
      expect(escalated.reviewer).toBe("senior-dev");
      expect(escalated.status).toBe("pending");
    });

    it("should preserve other fields", () => {
      const cp = createControlPoint("Deploy Gate", "gate", "coverage>90", "approve", "qa");
      const escalated = escalate(cp, "cto");
      expect(escalated.name).toBe("Deploy Gate");
      expect(escalated.type).toBe("gate");
      expect(escalated.condition).toBe("coverage>90");
      expect(escalated.reviewer).toBe("cto");
    });
  });

  describe("getPendingPoints", () => {
    it("should return only pending points", () => {
      const p1 = {
        ...createControlPoint("P1", "checkpoint", "x", "approve"),
        status: "pending" as const,
      };
      const p2 = { ...createControlPoint("P2", "gate", "y", "reject"), status: "passed" as const };
      const pending = getPendingPoints([p1, p2]);
      expect(pending).toHaveLength(1);
      expect(pending[0].name).toBe("P1");
    });
  });

  describe("getFailedPoints", () => {
    it("should return only failed points", () => {
      const p1 = {
        ...createControlPoint("P1", "checkpoint", "x", "approve"),
        status: "failed" as const,
      };
      const p2 = { ...createControlPoint("P2", "gate", "y", "reject"), status: "pending" as const };
      const failed = getFailedPoints([p1, p2]);
      expect(failed).toHaveLength(1);
      expect(failed[0].name).toBe("P1");
    });
  });

  describe("formatControlPoint", () => {
    it("should include status icon and details", () => {
      const cp = {
        ...createControlPoint("Review", "gate", "coverage>80", "approve"),
        status: "passed" as const,
      };
      const formatted = formatControlPoint(cp);
      expect(formatted).toContain("✅");
      expect(formatted).toContain("Review");
      expect(formatted).toContain("gate");
      expect(formatted).toContain("coverage>80");
      expect(formatted).toContain("approve");
      expect(formatted).toContain("passed");
    });
  });

  describe("formatControlPoints", () => {
    it("should handle empty list", () => {
      expect(formatControlPoints([])).toBe("No control points defined.");
    });

    it("should format all points", () => {
      const cp1 = createControlPoint("CP1", "checkpoint", "x", "approve");
      const cp2 = createControlPoint("CP2", "gate", "y", "reject");
      const formatted = formatControlPoints([cp1, cp2]);
      expect(formatted).toContain("CP1");
      expect(formatted).toContain("CP2");
    });
  });
});
