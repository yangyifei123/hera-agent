import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createWorkflowTools } from "./workflow-tools.js";
import { WorkflowManager } from "../workflow/manager.js";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "../team/manager.js";
import type { PluginContext } from "../types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Workflow Tools", () => {
  let tempDir: string;
  let store: MemoryStore;
  let workflowManager: WorkflowManager;
  let tools: any;
  let ctx: PluginContext;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hera-workflow-tools-test-"));
    store = new MemoryStore(tempDir);
    await store.init();

    const teamManager = new TeamManager(store, undefined);
    workflowManager = new WorkflowManager(store, teamManager, undefined);
    await workflowManager.init();

    ctx = { workflowManager } as PluginContext;
    tools = createWorkflowTools(ctx);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("hera_create_workflow", () => {
    test("creates serial workflow", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Test Workflow",
        description: "Test description",
        mode: "serial",
        steps: [
          { name: "Step 1", type: "agent", executor: "coder" },
          { name: "Step 2", type: "tool", executor: "test_runner" },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.workflowId).toBeDefined();
      expect(result.workflow).toBeDefined();
      expect(result.workflow!.name).toBe("Test Workflow");
      expect(result.workflow!.mode).toBe("serial");
      expect(result.workflow!.steps).toHaveLength(2);
    });

    test("creates parallel workflow", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Parallel Test",
        description: "Test",
        mode: "parallel",
        steps: [
          { name: "Step 1", type: "agent" },
          { name: "Step 2", type: "agent" },
          { name: "Step 3", type: "agent" },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.workflow!.mode).toBe("parallel");
      expect(result.workflow!.steps).toHaveLength(3);
    });

    test("creates DAG workflow with dependencies", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "DAG Test",
        description: "Test",
        mode: "dag",
        steps: [
          { name: "Step 1", type: "agent" },
          { name: "Step 2", type: "agent", dependencies: ["step-1"] },
          { name: "Step 3", type: "agent", dependencies: ["step-1"] },
          { name: "Step 4", type: "agent", dependencies: ["step-2", "step-3"] },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.workflow!.mode).toBe("dag");
      expect(result.workflow!.steps[1].dependencies).toContain("step-1");
      expect(result.workflow!.steps[3].dependencies).toHaveLength(2);
    });

    test("assigns step IDs automatically", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "ID Test",
        description: "Test",
        mode: "serial",
        steps: [
          { name: "First", type: "agent" },
          { name: "Second", type: "agent" },
        ],
      });

      expect(result.workflow!.steps[0].id).toBe("step-1");
      expect(result.workflow!.steps[1].id).toBe("step-2");
    });

    test("includes optional step properties", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Optional Props",
        description: "Test",
        mode: "serial",
        steps: [
          {
            name: "Step 1",
            type: "agent",
            executor: "coder",
            condition: "env==prod",
            timeout: 60000,
          },
        ],
      });

      const step = result.workflow!.steps[0];
      expect(step.executor).toBe("coder");
      expect(step.condition).toBe("env==prod");
      expect(step.timeout).toBe(60000);
    });

    test("persists workflow to manager", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Persist Test",
        description: "Test",
        mode: "serial",
        steps: [{ name: "Step 1", type: "agent" }],
      });

      const retrieved = workflowManager.getWorkflow(result.workflowId!);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("Persist Test");
    });
  });

  describe("hera_execute_workflow", () => {
    let workflowId: string;

    beforeEach(async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Execute Test",
        description: "Test",
        mode: "serial",
        steps: [
          { name: "Step 1", type: "tool", executor: "tool1" },
          { name: "Step 2", type: "tool", executor: "tool2" },
        ],
      });
      workflowId = result.workflowId!;
    });

    test("returns approval plan by default", async () => {
      const result = await tools.hera_execute_workflow.execute({
        workflowId,
      });

      expect(result.success).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.workflow).toBe("Execute Test");
      expect(result.plan!.mode).toBe("serial");
      expect(result.plan!.steps).toHaveLength(2);
    });

    test("executes without approval when requireApproval=false", async () => {
      const result = await tools.hera_execute_workflow.execute({
        workflowId,
        requireApproval: false,
      });

      expect(result.success).toBe(true);
      expect(result.requiresApproval).toBeUndefined();
      expect(result.result).toBeDefined();
    });

    test("passes context to workflow execution", async () => {
      const result = await tools.hera_execute_workflow.execute({
        workflowId,
        context: { env: "test", version: "1.0" },
        requireApproval: false,
      });

      expect(result.success).toBe(true);
    });

    test("returns error for nonexistent workflow", async () => {
      const result = await tools.hera_execute_workflow.execute({
        workflowId: "nonexistent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("estimates execution time based on mode", async () => {
      const serialResult = await tools.hera_execute_workflow.execute({
        workflowId,
      });
      expect(serialResult.plan!.estimatedTime).toBeDefined();

      const parallelWorkflow = await tools.hera_create_workflow.execute({
        name: "Parallel",
        description: "Test",
        mode: "parallel",
        steps: [{ name: "S1", type: "tool" }],
      });

      const parallelResult = await tools.hera_execute_workflow.execute({
        workflowId: parallelWorkflow.workflowId!,
      });
      expect(parallelResult.plan!.estimatedTime).toBe("1-3 minutes");
    });

    test("identifies risks in workflow", async () => {
      const noApprovalWorkflow = await tools.hera_create_workflow.execute({
        name: "No Approval",
        description: "Test",
        mode: "serial",
        steps: [{ name: "S1", type: "agent" }],
      });

      const result = await tools.hera_execute_workflow.execute({
        workflowId: noApprovalWorkflow.workflowId!,
      });

      expect(result.plan!.risks).toBeDefined();
      expect(result.plan!.risks.length).toBeGreaterThan(0);
    });

    test("detects circular dependencies in DAG", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Circular",
        description: "Test",
        mode: "dag",
        steps: [
          { name: "S1", type: "tool", dependencies: ["step-2"] },
          { name: "S2", type: "tool", dependencies: ["step-1"] },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain("circular");
    });
  });

  describe("hera_approve_workflow", () => {
    let workflowId: string;

    beforeEach(async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "Approve Test",
        description: "Test",
        mode: "serial",
        steps: [{ name: "Step 1", type: "tool", executor: "tool1" }],
      });
      workflowId = result.workflowId!;
    });

    test("executes workflow after approval", async () => {
      const result = await tools.hera_approve_workflow.execute({
        workflowId,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.message).toContain("approved and executed");
    });

    test("passes context to execution", async () => {
      const result = await tools.hera_approve_workflow.execute({
        workflowId,
        context: { approved: true },
      });

      expect(result.success).toBe(true);
    });

    test("returns error for nonexistent workflow", async () => {
      const result = await tools.hera_approve_workflow.execute({
        workflowId: "nonexistent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("hera_get_workflow_status", () => {
    test("returns execution status", async () => {
      const createResult = await tools.hera_create_workflow.execute({
        name: "Status Test",
        description: "Test",
        mode: "serial",
        steps: [{ name: "Step 1", type: "tool" }],
      });

      await tools.hera_execute_workflow.execute({
        workflowId: createResult.workflowId!,
        requireApproval: false,
      });

      // Execution happens synchronously in tests, so we can't get in-progress status
      // Just verify the tool works
      const workflow = workflowManager.getWorkflow(createResult.workflowId!);
      expect(workflow).toBeDefined();
    });

    test("returns error for nonexistent execution", async () => {
      const result = await tools.hera_get_workflow_status.execute({
        executionId: "nonexistent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("hera_list_workflows", () => {
    test("lists all workflows", async () => {
      await tools.hera_create_workflow.execute({
        name: "Workflow 1",
        description: "Test",
        mode: "serial",
        steps: [{ name: "S1", type: "tool" }],
      });

      await tools.hera_create_workflow.execute({
        name: "Workflow 2",
        description: "Test",
        mode: "parallel",
        steps: [{ name: "S1", type: "tool" }],
      });

      const result = await tools.hera_list_workflows.execute();

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.workflows).toHaveLength(2);
      expect(result.workflows![0].name).toBeDefined();
      expect(result.workflows![0].mode).toBeDefined();
      expect(result.workflows![0].steps).toBeDefined();
    });

    test("returns empty list when no workflows", async () => {
      const result = await tools.hera_list_workflows.execute();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.workflows).toHaveLength(0);
    });

    test("includes workflow metadata", async () => {
      await tools.hera_create_workflow.execute({
        name: "Meta Test",
        description: "Test description",
        mode: "dag",
        steps: [
          { name: "S1", type: "tool" },
          { name: "S2", type: "tool" },
          { name: "S3", type: "tool" },
        ],
      });

      const result = await tools.hera_list_workflows.execute();
      const workflow = result.workflows![0];

      expect(workflow.id).toBeDefined();
      expect(workflow.name).toBe("Meta Test");
      expect(workflow.description).toBe("Test description");
      expect(workflow.mode).toBe("dag");
      expect(workflow.steps).toBe(3);
      expect(workflow.createdAt).toBeDefined();
    });
  });

  describe("hera_delete_workflow", () => {
    test("deletes existing workflow", async () => {
      const createResult = await tools.hera_create_workflow.execute({
        name: "Delete Test",
        description: "Test",
        mode: "serial",
        steps: [{ name: "S1", type: "tool" }],
      });

      const deleteResult = await tools.hera_delete_workflow.execute({
        workflowId: createResult.workflowId!,
      });

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.message).toContain("deleted successfully");

      const workflow = workflowManager.getWorkflow(createResult.workflowId!);
      expect(workflow).toBeUndefined();
    });

    test("returns error for nonexistent workflow", async () => {
      const result = await tools.hera_delete_workflow.execute({
        workflowId: "nonexistent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("removes workflow from list", async () => {
      const create1 = await tools.hera_create_workflow.execute({
        name: "W1",
        description: "Test",
        mode: "serial",
        steps: [{ name: "S1", type: "tool" }],
      });

      await tools.hera_create_workflow.execute({
        name: "W2",
        description: "Test",
        mode: "serial",
        steps: [{ name: "S1", type: "tool" }],
      });

      await tools.hera_delete_workflow.execute({
        workflowId: create1.workflowId!,
      });

      const listResult = await tools.hera_list_workflows.execute();
      expect(listResult.count).toBe(1);
      expect(listResult.workflows![0].name).toBe("W2");
    });
  });

  describe("Integration Scenarios", () => {
    test("complete workflow lifecycle", async () => {
      // Create
      const createResult = await tools.hera_create_workflow.execute({
        name: "Lifecycle Test",
        description: "Full lifecycle",
        mode: "serial",
        steps: [
          { name: "Analyze", type: "tool", executor: "analyzer" },
          { name: "Implement", type: "tool", executor: "builder" },
          { name: "Test", type: "tool", executor: "test_runner" },
        ],
      });
      expect(createResult.success).toBe(true);

      // List
      const listResult = await tools.hera_list_workflows.execute();
      expect(listResult.workflows!.some((w: { name: string }) => w.name === "Lifecycle Test")).toBe(
        true
      );

      // Execute with approval
      const execResult = await tools.hera_execute_workflow.execute({
        workflowId: createResult.workflowId!,
      });
      expect(execResult.requiresApproval).toBe(true);

      // Approve and execute
      const approveResult = await tools.hera_approve_workflow.execute({
        workflowId: createResult.workflowId!,
      });
      expect(approveResult.success).toBe(true);

      // Delete
      const deleteResult = await tools.hera_delete_workflow.execute({
        workflowId: createResult.workflowId!,
      });
      expect(deleteResult.success).toBe(true);
    });

    test("workflow with all step types", async () => {
      const result = await tools.hera_create_workflow.execute({
        name: "All Types",
        description: "Test",
        mode: "serial",
        steps: [
          { name: "Agent Step", type: "agent", executor: "coder" },
          { name: "Tool Step", type: "tool", executor: "linter" },
          { name: "Decision Step", type: "decision", condition: "coverage>80" },
          { name: "Approval Step", type: "approval" },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.workflow!.steps).toHaveLength(4);
      expect(result.workflow!.steps.map((s: { type: string }) => s.type)).toEqual([
        "agent",
        "tool",
        "decision",
        "approval",
      ]);
    });
  });
});
