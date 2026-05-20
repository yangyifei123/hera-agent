import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkflowManager } from "./manager";
import { MemoryStore } from "../memory/store";
import type { WorkflowDefinition, WorkflowStep } from "../types";

describe("Workflow Stress Tests", () => {
  let manager: WorkflowManager;
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore("test-workflows-stress");
    await store.init();
    manager = new WorkflowManager(store);
  });

  afterEach(async () => {
    const workflows = manager.getAllWorkflows();
    for (const wf of workflows) {
      await manager.deleteWorkflow(wf.id);
    }
  });

  describe("Large DAG Workflows", () => {
    test("handles 50-step DAG with complex dependencies", async () => {
      const steps: WorkflowStep[] = [];

      // Create 50 steps with realistic dependency patterns
      for (let i = 0; i < 50; i++) {
        const step: WorkflowStep = {
          id: `step${i}`,
          name: `Step ${i}`,
          type: "tool",
          executor: `tool${i}`,
        };

        // Add dependencies to create a complex DAG
        if (i > 0) {
          step.dependsOn = [];
          // Each step depends on 1-3 previous steps
          const numDeps = Math.min(1 + (i % 3), i);
          for (let j = 0; j < numDeps; j++) {
            const depIndex = Math.max(0, i - 1 - j * 5);
            step.dependsOn.push(`step${depIndex}`);
          }
        }

        steps.push(step);
      }

      const workflow: WorkflowDefinition = {
        id: "large-dag",
        name: "Large DAG",
        description: "50-step DAG workflow",
        mode: "dag",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("large-dag", {});

      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(50);
    }, 30000);

    test("handles wide DAG with 30 parallel branches", async () => {
      const steps: WorkflowStep[] = [
        { id: "init", name: "Init", type: "tool", executor: "init" },
      ];

      // Create 30 parallel branches
      for (let i = 0; i < 30; i++) {
        steps.push({
          id: `branch${i}`,
          name: `Branch ${i}`,
          type: "tool",
          executor: `branch${i}`,
          dependsOn: ["init"],
        });
      }

      // Add a final merge step
      steps.push({
        id: "merge",
        name: "Merge",
        type: "tool",
        executor: "merge",
        dependsOn: steps.slice(1).map((s) => s.id),
      });

      const workflow: WorkflowDefinition = {
        id: "wide-dag",
        name: "Wide DAG",
        description: "30 parallel branches",
        mode: "dag",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("wide-dag", {});

      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(32); // init + 30 branches + merge
    }, 30000);

    test("handles deep DAG with 20-level dependency chain", async () => {
      const steps: WorkflowStep[] = [];

      // Create a 20-level deep chain
      for (let i = 0; i < 20; i++) {
        const step: WorkflowStep = {
          id: `level${i}`,
          name: `Level ${i}`,
          type: "tool",
          executor: `level${i}`,
        };

        if (i > 0) {
          step.dependsOn = [`level${i - 1}`];
        }

        steps.push(step);
      }

      const workflow: WorkflowDefinition = {
        id: "deep-dag",
        name: "Deep DAG",
        description: "20-level dependency chain",
        mode: "dag",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("deep-dag", {});

      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(20);
    }, 30000);
  });

  describe("Long Serial Workflows", () => {
    test("handles 100-step serial workflow", async () => {
      const steps: WorkflowStep[] = [];

      for (let i = 0; i < 100; i++) {
        steps.push({
          id: `step${i}`,
          name: `Step ${i}`,
          type: "tool",
          executor: `tool${i}`,
        });
      }

      const workflow: WorkflowDefinition = {
        id: "long-serial",
        name: "Long Serial",
        description: "100-step serial workflow",
        mode: "serial",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("long-serial", {});

      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(100);
    }, 30000);

    test("maintains context through 50 serial steps", async () => {
      const steps: WorkflowStep[] = [];

      for (let i = 0; i < 50; i++) {
        steps.push({
          id: `step${i}`,
          name: `Step ${i}`,
          type: "tool",
          executor: `tool${i}`,
        });
      }

      const workflow: WorkflowDefinition = {
        id: "context-serial",
        name: "Context Serial",
        description: "50-step context propagation",
        mode: "serial",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("context-serial", { initial: "value" });

      expect(execution.status).toBe("completed");
      expect(execution.context).toHaveProperty("initial");
    }, 30000);
  });

  describe("High Concurrency", () => {
    test("handles 50 parallel steps", async () => {
      const steps: WorkflowStep[] = [];

      for (let i = 0; i < 50; i++) {
        steps.push({
          id: `parallel${i}`,
          name: `Parallel ${i}`,
          type: "tool",
          executor: `parallel${i}`,
        });
      }

      const workflow: WorkflowDefinition = {
        id: "high-parallel",
        name: "High Parallel",
        description: "50 parallel steps",
        mode: "parallel",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("high-parallel", {});

      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(50);
    }, 30000);
  });

  describe("Multiple Concurrent Workflows", () => {
    test("executes 10 workflows concurrently", async () => {
      const workflows: WorkflowDefinition[] = [];

      for (let i = 0; i < 10; i++) {
        workflows.push({
          id: `concurrent${i}`,
          name: `Concurrent ${i}`,
          description: `Workflow ${i}`,
          mode: "serial",
          steps: [
            { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
            { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
            { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
          ],
          createdAt: Date.now(),
        });
      }

      // Create all workflows
      for (const wf of workflows) {
        await manager.createWorkflow(wf);
      }

      // Execute all concurrently
      const executions = await Promise.all(
        workflows.map((wf) => manager.executeWorkflow(wf.id, {}))
      );

      expect(executions).toHaveLength(10);
      for (const exec of executions) {
        expect(exec.status).toBe("completed");
        expect(Object.keys(exec.stepResults)).toHaveLength(3);
      }
    }, 30000);

    test("handles 20 workflows with mixed modes", async () => {
      const workflows: WorkflowDefinition[] = [];
      const modes: Array<"serial" | "parallel" | "dag"> = ["serial", "parallel", "dag"];

      for (let i = 0; i < 20; i++) {
        const mode = modes[i % 3];
        const steps: WorkflowStep[] = [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
          { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
        ];

        if (mode === "dag") {
          steps[1].dependsOn = ["step1"];
          steps[2].dependsOn = ["step1"];
        }

        workflows.push({
          id: `mixed${i}`,
          name: `Mixed ${i}`,
          description: `${mode} workflow`,
          mode,
          steps,
          createdAt: Date.now(),
        });
      }

      for (const wf of workflows) {
        await manager.createWorkflow(wf);
      }

      const executions = await Promise.all(
        workflows.map((wf) => manager.executeWorkflow(wf.id, {}))
      );

      expect(executions).toHaveLength(20);
      for (const exec of executions) {
        expect(exec.status).toBe("completed");
      }
    }, 30000);
  });

  describe("Memory and Performance", () => {
    test("handles workflow with large context data", async () => {
      const largeData = {
        array: Array(1000).fill("data"),
        nested: {
          level1: {
            level2: {
              level3: Array(100).fill({ key: "value" }),
            },
          },
        },
      };

      const workflow: WorkflowDefinition = {
        id: "large-context",
        name: "Large Context",
        description: "Workflow with large context",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
        ],
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("large-context", largeData);

      expect(execution.status).toBe("completed");
      expect(execution.context).toHaveProperty("array");
      expect(execution.context.array).toHaveLength(1000);
    }, 30000);

    test("creates and deletes 100 workflows rapidly", async () => {
      const workflows: WorkflowDefinition[] = [];

      for (let i = 0; i < 100; i++) {
        workflows.push({
          id: `rapid${i}`,
          name: `Rapid ${i}`,
          description: `Workflow ${i}`,
          mode: "serial",
          steps: [
            { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          ],
          createdAt: Date.now(),
        });
      }

      // Create all
      for (const wf of workflows) {
        await manager.createWorkflow(wf);
      }

      let list = manager.getAllWorkflows();
      expect(list.length).toBeGreaterThanOrEqual(100);

      // Delete all
      for (const wf of workflows) {
        await manager.deleteWorkflow(wf.id);
      }

      list = manager.getAllWorkflows();
      expect(list.length).toBe(0);
    }, 30000);
  });

  describe("Error Resilience", () => {
    test("handles partial failures in large parallel workflow", async () => {
      const steps: WorkflowStep[] = [];

      for (let i = 0; i < 30; i++) {
        steps.push({
          id: `step${i}`,
          name: `Step ${i}`,
          type: "tool",
          executor: i % 5 === 0 ? "failing-tool" : `tool${i}`,
        });
      }

      const workflow: WorkflowDefinition = {
        id: "partial-fail",
        name: "Partial Fail",
        description: "Workflow with some failing steps",
        mode: "parallel",
        steps,
        createdAt: Date.now(),
      };

      await manager.createWorkflow(workflow);
      const execution = await manager.executeWorkflow("partial-fail", {});

      // Should complete even with some failures
      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults).length).toBeGreaterThan(0);
    }, 30000);
  });
});
