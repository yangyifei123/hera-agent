import { describe, test, expect } from "bun:test";
import { WorkflowValidator } from "./validator.js";
import type { WorkflowDefinition } from "../types.js";

describe("WorkflowValidator", () => {
  describe("validate", () => {
    test("validates correct workflow", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool" },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("detects missing workflow ID", () => {
      const workflow: WorkflowDefinition = {
        id: "",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "agent" }],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Workflow ID is required");
    });

    test("detects duplicate step IDs", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step1", name: "Step 1 Duplicate", type: "tool" },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Duplicate step ID"))).toBe(true);
    });

    test("detects non-existent dependencies", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool", dependencies: ["nonexistent"] },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("non-existent step"))).toBe(true);
    });

    test("detects self-dependency", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent", dependencies: ["step1"] },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("cannot depend on itself"))).toBe(true);
    });

    test("detects circular dependencies", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent", dependencies: ["step2"] },
          { id: "step2", name: "Step 2", type: "tool", dependencies: ["step1"] },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Circular dependency"))).toBe(true);
    });

    test("detects invalid timeout", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent", timeout: -100 },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("invalid timeout"))).toBe(true);
    });

    test("detects invalid retry policy", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            type: "agent",
            retryPolicy: { maxAttempts: -1, backoffMs: 1000 },
          },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("invalid retry maxAttempts"))).toBe(true);
    });

    test("warns about DAG with no dependencies", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool" },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("no dependencies"))).toBe(true);
    });
  });

  describe("hasApprovalSteps", () => {
    test("detects approval steps", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Approval", type: "approval" },
        ],
        createdAt: Date.now(),
      };

      expect(WorkflowValidator.hasApprovalSteps(workflow)).toBe(true);
    });

    test("returns false when no approval steps", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
        ],
        createdAt: Date.now(),
      };

      expect(WorkflowValidator.hasApprovalSteps(workflow)).toBe(false);
    });
  });

  describe("getLeafSteps", () => {
    test("identifies leaf steps", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool", dependencies: ["step1"] },
          { id: "step3", name: "Step 3", type: "tool", dependencies: ["step1"] },
        ],
        createdAt: Date.now(),
      };

      const leaves = WorkflowValidator.getLeafSteps(workflow);
      expect(leaves).toHaveLength(2);
      expect(leaves.map(s => s.id)).toContain("step2");
      expect(leaves.map(s => s.id)).toContain("step3");
    });
  });

  describe("getRootSteps", () => {
    test("identifies root steps", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool", dependencies: ["step1"] },
        ],
        createdAt: Date.now(),
      };

      const roots = WorkflowValidator.getRootSteps(workflow);
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe("step1");
    });
  });

  describe("estimateComplexity", () => {
    test("estimates complexity for simple workflow", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool" },
        ],
        createdAt: Date.now(),
      };

      const complexity = WorkflowValidator.estimateComplexity(workflow);
      expect(complexity).toBeGreaterThan(0);
      expect(complexity).toBeLessThan(50);
    });

    test("estimates higher complexity for DAG with dependencies", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "tool", dependencies: ["step1"] },
          { id: "step3", name: "Step 3", type: "approval", dependencies: ["step2"] },
          { id: "step4", name: "Step 4", type: "tool", dependencies: ["step2"], condition: "result==success" },
        ],
        createdAt: Date.now(),
      };

      const complexity = WorkflowValidator.estimateComplexity(workflow);
      expect(complexity).toBeGreaterThan(40);
    });

    test("caps complexity at 100", () => {
      const steps = Array.from({ length: 50 }, (_, i) => ({
        id: `step${i}`,
        name: `Step ${i}`,
        type: "agent" as const,
        dependencies: i > 0 ? [`step${i - 1}`] : undefined,
        condition: "true",
        retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
      }));

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps,
        createdAt: Date.now(),
      };

      const complexity = WorkflowValidator.estimateComplexity(workflow);
      expect(complexity).toBe(100);
    });
  });
});
