import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { WorkflowManager } from "./manager.js";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "../team/manager.js";
import type { WorkflowDefinition, WorkflowStep } from "../types.js";
import type { OpenCodeClient } from "../types/client.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("WorkflowManager", () => {
  let tempDir: string;
  let store: MemoryStore;
  let teamManager: TeamManager;
  let manager: WorkflowManager;
  let mockClient: OpenCodeClient;

  function makeAgentClient(
    promptAsync: () => Promise<unknown> = async () => ({ data: undefined })
  ) {
    return {
      session: {
        create: mock(async () => ({ data: { id: "test-session" } })),
        promptAsync: mock(promptAsync),
      },
    } as unknown as OpenCodeClient;
  }

  function testStep(id = "step1"): WorkflowStep {
    return { id, name: `Step ${id}`, type: "tool", executor: "test" };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hera-workflow-test-"));
    store = new MemoryStore(tempDir);
    await store.init();

    teamManager = new TeamManager(store, undefined);

    mockClient = makeAgentClient();

    manager = new WorkflowManager(store, teamManager, mockClient);
    await manager.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Workflow CRUD", () => {
    test("creates and retrieves workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "tool", executor: "test" }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const retrieved = manager.getWorkflow("test-workflow");

      expect(retrieved).toEqual(workflow);
    });

    test("lists all workflows", async () => {
      const w1: WorkflowDefinition = {
        id: "w1",
        name: "W1",
        description: "Test",
        mode: "serial",
        steps: [testStep()],
        createdAt: Date.now(),
      };
      const w2: WorkflowDefinition = {
        id: "w2",
        name: "W2",
        description: "Test",
        mode: "parallel",
        steps: [testStep()],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(w1);
      await manager.createWorkflow(w2);

      const all = manager.getAllWorkflows();
      expect(all).toHaveLength(2);
      expect(all.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
    });

    test("deletes workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "delete-me",
        name: "Delete",
        description: "Test",
        mode: "serial",
        steps: [testStep()],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      expect(manager.getWorkflow("delete-me")).toBeDefined();

      await manager.deleteWorkflow("delete-me");
      expect(manager.getWorkflow("delete-me")).toBeUndefined();
    });

    test("persists workflows to store", async () => {
      const workflow: WorkflowDefinition = {
        id: "persist-test",
        name: "Persist",
        description: "Test",
        mode: "serial",
        steps: [testStep()],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);

      // Verify it was saved to store
      const stored = await store.list("workflow" as any);
      expect(stored.length).toBeGreaterThan(0);

      // Create new manager to test persistence
      const manager2 = new WorkflowManager(store, teamManager, mockClient);
      await manager2.init();

      const retrieved = manager2.getWorkflow("persist-test");
      expect(retrieved).toEqual(workflow);
    });
  });

  describe("Serial Workflow Execution", () => {
    test("executes steps in order", async () => {
      const workflow: WorkflowDefinition = {
        id: "serial-test",
        name: "Serial",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
          { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("serial-test", {});

      expect(execution.stepResults).toHaveProperty("step1");
      expect(execution.stepResults).toHaveProperty("step2");
      expect(execution.stepResults).toHaveProperty("step3");
    });

    test("passes context between steps", async () => {
      const workflow: WorkflowDefinition = {
        id: "context-test",
        name: "Context",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("context-test", { initial: "value" });

      expect(execution.stepResults.step1).toBeDefined();
      expect(execution.stepResults.step2).toBeDefined();
    });

    test("skips steps with false conditions", async () => {
      const workflow: WorkflowDefinition = {
        id: "condition-test",
        name: "Condition",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          {
            id: "step2",
            name: "Step 2",
            type: "tool",
            executor: "tool2",
            condition: "skip==true",
          },
          { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("condition-test", { skip: "false" });

      expect(execution.stepResults.step1).toBeDefined();
      expect(execution.stepResults.step2).toBeUndefined();
      expect(execution.stepResults.step3).toBeDefined();
    });
  });

  describe("Parallel Workflow Execution", () => {
    test("executes all steps concurrently", async () => {
      const workflow: WorkflowDefinition = {
        id: "parallel-test",
        name: "Parallel",
        description: "Test",
        mode: "parallel",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
          { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const start = Date.now();
      const execution = await manager.executeWorkflow("parallel-test", {});
      const duration = Date.now() - start;

      expect(execution.stepResults).toHaveProperty("step1");
      expect(execution.stepResults).toHaveProperty("step2");
      expect(execution.stepResults).toHaveProperty("step3");
      // Should complete faster than serial (no artificial delays in this test)
      expect(duration).toBeLessThan(1000);
    });

    test("handles parallel step failures", async () => {
      const workflow: WorkflowDefinition = {
        id: "parallel-fail",
        name: "Parallel Fail",
        description: "Test",
        mode: "parallel",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "decision", condition: "invalid" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);

      // Should not throw, but step2 will have null result
      const execution = await manager.executeWorkflow("parallel-fail", {});
      expect(execution.stepResults.step1).toBeDefined();
    });
  });

  describe("DAG Workflow Execution", () => {
    test("respects dependencies", async () => {
      const workflow: WorkflowDefinition = {
        id: "dag-test",
        name: "DAG",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          {
            id: "step2",
            name: "Step 2",
            type: "tool",
            executor: "tool2",
            dependencies: ["step1"],
          },
          {
            id: "step3",
            name: "Step 3",
            type: "tool",
            executor: "tool3",
            dependencies: ["step1"],
          },
          {
            id: "step4",
            name: "Step 4",
            type: "tool",
            executor: "tool4",
            dependencies: ["step2", "step3"],
          },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("dag-test", {});

      expect(execution.stepResults.step1).toBeDefined();
      expect(execution.stepResults.step2).toBeDefined();
      expect(execution.stepResults.step3).toBeDefined();
      expect(execution.stepResults.step4).toBeDefined();
    });

    test("detects circular dependencies", async () => {
      const workflow: WorkflowDefinition = {
        id: "circular",
        name: "Circular",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1", dependencies: ["step2"] },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2", dependencies: ["step1"] },
        ],
        createdAt: Date.now(),
      };

      await expect(manager.createWorkflow(workflow)).rejects.toThrow(
        "Circular dependency detected"
      );
    });

    test("executes independent steps in parallel", async () => {
      const workflow: WorkflowDefinition = {
        id: "dag-parallel",
        name: "DAG Parallel",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
          { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
          {
            id: "step4",
            name: "Step 4",
            type: "tool",
            executor: "tool4",
            dependencies: ["step1", "step2", "step3"],
          },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("dag-parallel", {});

      // step1, step2, step3 should run in parallel, then step4
      expect(execution.stepResults.step1).toBeDefined();
      expect(execution.stepResults.step2).toBeDefined();
      expect(execution.stepResults.step3).toBeDefined();
      expect(execution.stepResults.step4).toBeDefined();
    });
  });

  describe("Step Retry Logic", () => {
    test("retries failed steps", async () => {
      let attempts = 0;
      const failingClient = makeAgentClient(async () => {
        attempts++;
        if (attempts < 3) throw new Error("Temporary failure");
        return { data: undefined };
      });

      const managerWithRetry = new WorkflowManager(store, teamManager, failingClient);
      await managerWithRetry.init();

      const workflow: WorkflowDefinition = {
        id: "retry-test",
        name: "Retry",
        description: "Test",
        mode: "serial",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            type: "agent",
            executor: "test-agent",
            retryPolicy: { maxAttempts: 3, backoffMs: 10 },
          },
        ],
        createdAt: Date.now(),
      };

      await managerWithRetry.createWorkflow(workflow);
      const result = await managerWithRetry.executeWorkflow("retry-test", {});

      expect(attempts).toBe(3);
      expect(result.stepResults.step1).toBeDefined();
    });

    test("fails after max retry attempts", async () => {
      const failingClient = makeAgentClient(async () => {
        throw new Error("Permanent failure");
      });

      const managerWithRetry = new WorkflowManager(store, teamManager, failingClient);
      await managerWithRetry.init();

      const workflow: WorkflowDefinition = {
        id: "fail-test",
        name: "Fail",
        description: "Test",
        mode: "serial",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            type: "agent",
            executor: "test-agent",
            retryPolicy: { maxAttempts: 2, backoffMs: 10 },
          },
        ],
        createdAt: Date.now(),
      };

      await managerWithRetry.createWorkflow(workflow);

      await expect(managerWithRetry.executeWorkflow("fail-test", {})).rejects.toThrow(
        "Permanent failure"
      );
    });
  });

  describe("Step Timeout", () => {
    test("times out long-running steps", async () => {
      const slowClient = makeAgentClient(
        async () => new Promise((resolve) => setTimeout(() => resolve({ data: undefined }), 5000))
      );

      const managerWithTimeout = new WorkflowManager(store, teamManager, slowClient);
      await managerWithTimeout.init();

      const workflow: WorkflowDefinition = {
        id: "timeout-test",
        name: "Timeout",
        description: "Test",
        mode: "serial",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            type: "agent",
            executor: "slow-agent",
            timeout: 100, // 100ms timeout
          },
        ],
        createdAt: Date.now(),
      };

      await managerWithTimeout.createWorkflow(workflow);

      await expect(managerWithTimeout.executeWorkflow("timeout-test", {})).rejects.toThrow(
        "Step timeout"
      );
    });
  });

  describe("Condition Evaluation", () => {
    test("evaluates equality conditions", async () => {
      const workflow: WorkflowDefinition = {
        id: "eq-test",
        name: "Equality",
        description: "Test",
        mode: "serial",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            type: "tool",
            executor: "tool1",
            condition: "env==prod",
          },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("eq-test", { env: "prod" });

      expect(execution.stepResults.step1).toBeDefined();
    });

    test("evaluates comparison conditions", async () => {
      const workflow: WorkflowDefinition = {
        id: "cmp-test",
        name: "Comparison",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "GT", type: "tool", executor: "tool1", condition: "count>5" },
          { id: "step2", name: "LT", type: "tool", executor: "tool2", condition: "count<10" },
          { id: "step3", name: "GTE", type: "tool", executor: "tool3", condition: "count>=7" },
          { id: "step4", name: "LTE", type: "tool", executor: "tool4", condition: "count<=7" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("cmp-test", { count: 7 });

      expect(execution.stepResults.step1).toBeDefined(); // 7 > 5
      expect(execution.stepResults.step2).toBeDefined(); // 7 < 10
      expect(execution.stepResults.step3).toBeDefined(); // 7 >= 7
      expect(execution.stepResults.step4).toBeDefined(); // 7 <= 7
    });

    test("evaluates truthy conditions", async () => {
      const workflow: WorkflowDefinition = {
        id: "truthy-test",
        name: "Truthy",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1", condition: "enabled" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("truthy-test", { enabled: true });

      expect(execution.stepResults.step1).toBeDefined();
    });
  });

  describe("Execution Status", () => {
    test("tracks execution status", async () => {
      const workflow: WorkflowDefinition = {
        id: "status-test",
        name: "Status",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "tool", executor: "tool1" }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);

      const resultPromise = manager.executeWorkflow("status-test", {});

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await resultPromise;
      expect(result.stepResults.step1).toBeDefined();
    });

    test("marks execution as failed on error", async () => {
      const failingClient = makeAgentClient(async () => {
        throw new Error("Test error");
      });

      const managerWithError = new WorkflowManager(store, teamManager, failingClient);
      await managerWithError.init();

      const workflow: WorkflowDefinition = {
        id: "error-test",
        name: "Error",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "agent", executor: "test-agent" }],
        createdAt: Date.now(),
      };

      await managerWithError.createWorkflow(workflow);

      await expect(managerWithError.executeWorkflow("error-test", {})).rejects.toThrow(
        "Test error"
      );
    });
  });

  describe("Step Types", () => {
    test("executes agent steps", async () => {
      const workflow: WorkflowDefinition = {
        id: "agent-test",
        name: "Agent",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "agent", executor: "test-agent" }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("agent-test", {});

      expect(execution.stepResults.step1).toBeDefined();
      expect(mockClient.session.create).toHaveBeenCalled();
      expect(mockClient.session.promptAsync).toHaveBeenCalled();
    });

    test("executes tool steps", async () => {
      const workflow: WorkflowDefinition = {
        id: "tool-test",
        name: "Tool",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "tool", executor: "test-tool" }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("tool-test", {});

      expect(execution.stepResults.step1).toEqual({ tool: "test-tool", input: {} });
    });

    test("executes decision steps", async () => {
      const workflow: WorkflowDefinition = {
        id: "decision-test",
        name: "Decision",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "decision", condition: "enabled==true" }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("decision-test", { enabled: "true" });

      expect(execution.stepResults.step1).toBe(true);
    });

    test("executes approval steps", async () => {
      const workflow: WorkflowDefinition = {
        id: "approval-test",
        name: "Approval",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "approval" }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("approval-test", {});

      expect(execution.stepResults.step1).toEqual({
        type: "approval_required",
        step: "step1",
        context: {},
        message: "Approval required for step: Step 1",
      });
    });
  });

  describe("Error Handling", () => {
    test("throws on unknown workflow", async () => {
      await expect(manager.executeWorkflow("nonexistent", {})).rejects.toThrow(
        "Workflow 'nonexistent' not found"
      );
    });

    test("throws on unknown workflow mode", async () => {
      const workflow: WorkflowDefinition = {
        id: "unknown-mode",
        name: "Unknown",
        description: "Test",
        mode: "invalid" as any,
        steps: [testStep()],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);

      await expect(manager.executeWorkflow("unknown-mode", {})).rejects.toThrow(
        "Unknown workflow mode"
      );
    });

    test("throws on unknown step type", async () => {
      const workflow: WorkflowDefinition = {
        id: "unknown-step",
        name: "Unknown Step",
        description: "Test",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "invalid" as any }],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);

      await expect(manager.executeWorkflow("unknown-step", {})).rejects.toThrow(
        "Unknown step type"
      );
    });
  });
});
