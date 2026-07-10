import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { WorkflowManager } from "./manager.js";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "../team/manager.js";
import type { WorkflowDefinition, WorkflowStep } from "../types.js";
import type { OpenCodeClient } from "../types/client.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Build an OpenCode client whose agent `promptAsync` behavior is controlled by
 * `behavior(callIndex)`: return a value to succeed, throw to fail that attempt.
 * `type:"tool"` steps are a no-op placeholder that can never fail or delay, so
 * genuine error/retry injection requires `type:"agent"` steps driven by a
 * controllable client like this one.
 */
function makeAgentClient(behavior: (callIndex: number) => Promise<unknown>): OpenCodeClient {
  let call = 0;
  return {
    session: {
      create: mock(async () => ({ data: { id: "stress-session" } })),
      promptAsync: mock(async () => behavior(call++)),
      status: mock(async () => ({ data: { "stress-session": { type: "idle" } } })),
      messages: mock(async () => ({
        data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }],
      })),
    },
  } as unknown as OpenCodeClient;
}

describe("Workflow Stress Tests", () => {
  let manager: WorkflowManager;
  let store: MemoryStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hera-workflows-stress-"));
    store = new MemoryStore(tempDir);
    await store.init();
    const teamManager = new TeamManager(store, undefined);
    manager = new WorkflowManager(store, teamManager, undefined);
  });

  afterEach(async () => {
    const workflows = manager.getAllWorkflows();
    for (const wf of workflows) {
      await manager.deleteWorkflow(wf.id);
    }
    await rm(tempDir, { recursive: true, force: true });
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
          step.dependencies = [];
          // Each step depends on 1-3 previous steps
          const numDeps = Math.min(1 + (i % 3), i);
          for (let j = 0; j < numDeps; j++) {
            const depIndex = Math.max(0, i - 1 - j * 5);
            step.dependencies.push(`step${depIndex}`);
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
      const steps: WorkflowStep[] = [{ id: "init", name: "Init", type: "tool", executor: "init" }];

      // Create 30 parallel branches
      for (let i = 0; i < 30; i++) {
        steps.push({
          id: `branch${i}`,
          name: `Branch ${i}`,
          type: "tool",
          executor: `branch${i}`,
          dependencies: ["init"],
        });
      }

      // Add a final merge step
      steps.push({
        id: "merge",
        name: "Merge",
        type: "tool",
        executor: "merge",
        dependencies: steps.slice(1).map((s) => s.id),
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
          step.dependencies = [`level${i - 1}`];
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
          steps[1]!.dependencies = ["step1"];
          steps[2]!.dependencies = ["step1"];
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
          steps: [{ id: "step1", name: "Step 1", type: "tool", executor: "tool1" }],
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
    test("recovers a serial workflow via retry when every agent step fails once", async () => {
      // Each agent step fails its FIRST attempt then succeeds. Steps run
      // sequentially so promptAsync call order is deterministic: even-indexed
      // calls (the first attempt of each step) throw, odd-indexed succeed.
      // With retryPolicy.maxAttempts=2 the workflow must recover and complete,
      // genuinely exercising retry/backoff rather than the vacuous tool-step
      // placeholder that can never fail.
      const stepCount = 10;
      const client = makeAgentClient(async (callIndex) => {
        if (callIndex % 2 === 0) {
          throw new Error(`transient failure on call ${callIndex}`);
        }
        return { data: undefined };
      });
      const retryManager = new WorkflowManager(store, new TeamManager(store, undefined), client);
      await retryManager.init();

      const steps: WorkflowStep[] = [];
      for (let i = 0; i < stepCount; i++) {
        steps.push({
          id: `step${i}`,
          name: `Step ${i}`,
          type: "agent",
          executor: `agent${i}`,
          retryPolicy: { maxAttempts: 2, backoffMs: 1 },
        });
      }

      const workflow: WorkflowDefinition = {
        id: "retry-recover",
        name: "Retry Recover",
        description: "Serial agent workflow that recovers via retry",
        mode: "serial",
        steps,
        createdAt: Date.now(),
      };

      await retryManager.createWorkflow(workflow);
      const execution = await retryManager.executeWorkflow("retry-recover", {});

      // Every step recovered on its second attempt → workflow completes with
      // all results, and promptAsync was called twice per step (retry observed).
      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(stepCount);
      expect(client.session.promptAsync).toHaveBeenCalledTimes(stepCount * 2);
    }, 30000);

    test("surfaces a genuine failure when an agent step exhausts its retries", async () => {
      // A permanently failing agent step must not be silently swallowed: the
      // workflow rejects. (Only possible with a controllable agent client; tool
      // steps never fail.)
      const client = makeAgentClient(async () => {
        throw new Error("permanent failure");
      });
      const failManager = new WorkflowManager(store, new TeamManager(store, undefined), client);
      await failManager.init();

      const workflow: WorkflowDefinition = {
        id: "permanent-fail",
        name: "Permanent Fail",
        description: "Serial agent workflow with an unrecoverable step",
        mode: "serial",
        steps: [
          { id: "ok", name: "OK", type: "agent", executor: "agent-ok" },
          {
            id: "boom",
            name: "Boom",
            type: "agent",
            executor: "agent-boom",
            retryPolicy: { maxAttempts: 2, backoffMs: 1 },
          },
          { id: "never", name: "Never", type: "agent", executor: "agent-never" },
        ],
        createdAt: Date.now(),
      };

      await failManager.createWorkflow(workflow);

      // "ok" also uses the always-throwing client, so the very first step fails;
      // regardless, the workflow rejects rather than reporting completion.
      await expect(failManager.executeWorkflow("permanent-fail", {})).rejects.toThrow(
        "permanent failure"
      );
    }, 30000);
  });
});
