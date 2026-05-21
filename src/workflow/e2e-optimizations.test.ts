import { describe, test, expect, beforeAll } from "bun:test";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "../team/manager.js";
import { WorkflowManager } from "../workflow/manager.js";
import { WorkflowValidator } from "../workflow/validator.js";
import { ConcurrencyLimiter } from "../workflow/progress.js";
import type { WorkflowDefinition } from "../types.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  WorkflowNotFoundError,
  WorkflowValidationError,
  WorkflowExecutionError,
  CircularDependencyError,
} from "../errors.js";

describe("End-to-End Tests - P0 Optimizations", () => {
  let tempDir: string;
  let store: MemoryStore;
  let teamManager: TeamManager;
  let workflowManager: WorkflowManager;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hera-e2e-"));
    store = new MemoryStore(join(tempDir, "memory"));
    await store.init();
    teamManager = new TeamManager(store, undefined);
    await teamManager.init();
    workflowManager = new WorkflowManager(store, teamManager, undefined);
    await workflowManager.init();
  });

  describe("错误处理增强", () => {
    test("WorkflowNotFoundError - 结构化错误信息", async () => {
      try {
        await workflowManager.executeWorkflow("non-existent");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowNotFoundError);
        expect((error as WorkflowNotFoundError).message).toContain("non-existent");
        expect((error as WorkflowNotFoundError).details).toEqual({ workflowId: "non-existent" });
      }
    });

    test("WorkflowValidationError - 验证失败时抛出", async () => {
      const invalidWorkflow: WorkflowDefinition = {
        id: "invalid",
        name: "Invalid",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent", dependencies: ["nonexistent"] },
        ],
        createdAt: Date.now(),
      };

      try {
        await workflowManager.createWorkflow(invalidWorkflow);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowValidationError);
        expect((error as WorkflowValidationError).message).toContain("validation failed");
      }
    });

    test("CircularDependencyError - 循环依赖检测", async () => {
      const circularWorkflow: WorkflowDefinition = {
        id: "circular",
        name: "Circular",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent", dependencies: ["step2"] },
          { id: "step2", name: "Step 2", type: "agent", dependencies: ["step1"] },
        ],
        createdAt: Date.now(),
      };

      try {
        await workflowManager.createWorkflow(circularWorkflow);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowValidationError);
        expect((error as WorkflowValidationError).message).toContain("Circular dependency");
      }
    });
  });

  describe("输入验证增强", () => {
    test("WorkflowValidator - 完整验证流程", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "agent", dependencies: ["step1"] },
          { id: "step3", name: "Step 3", type: "approval", dependencies: ["step2"] },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("WorkflowValidator - 检测重复步骤ID", () => {
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step1", name: "Step 1 Duplicate", type: "agent" },
        ],
        createdAt: Date.now(),
      };

      const result = WorkflowValidator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Duplicate step ID"))).toBe(true);
    });

    test("WorkflowValidator - 检测无效超时", () => {
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

    test("WorkflowValidator - 复杂度评估", () => {
      const simpleWorkflow: WorkflowDefinition = {
        id: "simple",
        name: "Simple",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "agent" },
        ],
        createdAt: Date.now(),
      };

      const complexWorkflow: WorkflowDefinition = {
        id: "complex",
        name: "Complex",
        description: "Test",
        mode: "dag",
        steps: [
          { id: "step1", name: "Step 1", type: "agent" },
          { id: "step2", name: "Step 2", type: "agent", dependencies: ["step1"] },
          { id: "step3", name: "Step 3", type: "approval", dependencies: ["step2"] },
          { id: "step4", name: "Step 4", type: "agent", dependencies: ["step2"], condition: "result==success" },
        ],
        createdAt: Date.now(),
      };

      const simpleComplexity = WorkflowValidator.estimateComplexity(simpleWorkflow);
      const complexComplexity = WorkflowValidator.estimateComplexity(complexWorkflow);

      expect(simpleComplexity).toBeLessThan(50);
      expect(complexComplexity).toBeGreaterThan(40);
      expect(complexComplexity).toBeGreaterThan(simpleComplexity);
    });
  });

  describe("资源管理和内存清理", () => {
    test("WorkflowManager - 执行历史清理", async () => {
      const workflow: WorkflowDefinition = {
        id: "cleanup-test",
        name: "Cleanup Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "decision", condition: "true" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);

      // 执行多次工作流
      for (let i = 0; i < 5; i++) {
        await workflowManager.executeWorkflow("cleanup-test");
      }

      const statsBefore = workflowManager.getExecutionStats();
      expect(statsBefore.total).toBeGreaterThanOrEqual(5);

      // 手动触发清理（模拟24小时后）
      const cleaned = await workflowManager.cleanupOldExecutions();

      // 由于执行刚完成，不会清理（需要24小时）
      expect(cleaned).toBe(0);

      const statsAfter = workflowManager.getExecutionStats();
      expect(statsAfter.total).toBe(statsBefore.total);
    });

    test("WorkflowManager - 执行统计", async () => {
      const stats = workflowManager.getExecutionStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("running");
      expect(stats).toHaveProperty("completed");
      expect(stats).toHaveProperty("failed");
      expect(stats).toHaveProperty("paused");

      expect(typeof stats.total).toBe("number");
      expect(typeof stats.completed).toBe("number");
    });
  });

  describe("并发控制", () => {
    test("ConcurrencyLimiter - 限制并发数量", async () => {
      const limiter = new ConcurrencyLimiter(3);
      let concurrent = 0;
      let maxConcurrent = 0;

      const tasks = Array.from({ length: 10 }, (_, i) =>
        limiter.run(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise(resolve => setTimeout(resolve, 10));
          concurrent--;
          return i;
        })
      );

      const results = await Promise.all(tasks);

      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    test("ConcurrencyLimiter - 获取统计信息", async () => {
      const limiter = new ConcurrencyLimiter(2);

      const task1 = limiter.run(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 1;
      });

      const task2 = limiter.run(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 2;
      });

      // 第三个任务会排队
      const task3Promise = limiter.run(async () => {
        return 3;
      });

      // 等待一小段时间让任务开始
      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = limiter.getStats();
      expect(stats.maxConcurrent).toBe(2);
      expect(stats.running).toBeLessThanOrEqual(2);

      await Promise.all([task1, task2, task3Promise]);
    });
  });

  describe("进度回调", () => {
    test("WorkflowManager - 进度回调触发", async () => {
      const workflow: WorkflowDefinition = {
        id: "progress-test",
        name: "Progress Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "echo", input: { message: "test1" } },
          { id: "step2", name: "Step 2", type: "tool", executor: "echo", input: { message: "test2" } },
          { id: "step3", name: "Step 3", type: "tool", executor: "echo", input: { message: "test3" } },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);

      const events: string[] = [];
      let progressUpdates = 0;

      await workflowManager.executeWorkflow("progress-test", {}, {
        onStepStart: (stepId, stepName) => {
          events.push(`start:${stepId}`);
        },
        onStepComplete: (stepId, result) => {
          events.push(`complete:${stepId}`);
          expect(result.status).toBe('success');
          expect(result.duration).toBeGreaterThanOrEqual(0);
        },
        onWorkflowProgress: (completed, total, percentage) => {
          progressUpdates++;
          expect(completed).toBeLessThanOrEqual(total);
          expect(percentage).toBeGreaterThanOrEqual(0);
          expect(percentage).toBeLessThanOrEqual(100);
        },
      });

      expect(events).toContain("start:step1");
      expect(events).toContain("complete:step1");
      expect(events).toContain("start:step2");
      expect(events).toContain("complete:step2");
      expect(events).toContain("start:step3");
      expect(events).toContain("complete:step3");
      expect(progressUpdates).toBe(3);
    });
  });

  describe("完整工作流场景", () => {
    test("端到端 - 创建、验证、执行、清理", async () => {
      const workflow: WorkflowDefinition = {
        id: "e2e-test",
        name: "E2E Test",
        description: "Complete end-to-end test",
        mode: "dag",
        steps: [
          { id: "init", name: "Initialize", type: "tool", executor: "init", input: { value: 1 } },
          { id: "process", name: "Process", type: "tool", executor: "process", input: { value: 2 }, dependencies: ["init"] },
          { id: "validate", name: "Validate", type: "tool", executor: "validate", input: { value: 3 }, dependencies: ["process"] },
        ],
        createdAt: Date.now(),
      };

      // 1. 验证
      const validation = WorkflowValidator.validate(workflow);
      expect(validation.valid).toBe(true);

      // 2. 创建
      await workflowManager.createWorkflow(workflow);
      const retrieved = workflowManager.getWorkflow("e2e-test");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("e2e-test");

      // 3. 执行
      const execution = await workflowManager.executeWorkflow("e2e-test");
      expect(execution.status).toBe("completed");
      expect(execution.stepResults).toHaveProperty("init");
      expect(execution.stepResults).toHaveProperty("process");
      expect(execution.stepResults).toHaveProperty("validate");

      // 4. 查询状态
      const status = workflowManager.getExecutionStatus(execution.id);
      expect(status).toBeDefined();
      expect(status?.status).toBe("completed");

      // 5. 统计
      const stats = workflowManager.getExecutionStats();
      expect(stats.completed).toBeGreaterThan(0);

      // 6. 删除
      const deleted = await workflowManager.deleteWorkflow("e2e-test");
      expect(deleted).toBe(true);

      const afterDelete = workflowManager.getWorkflow("e2e-test");
      expect(afterDelete).toBeUndefined();
    });
  });

  describe("性能和稳定性", () => {
    test("大规模工作流 - 50步DAG", async () => {
      const steps = Array.from({ length: 50 }, (_, i) => ({
        id: `step${i}`,
        name: `Step ${i}`,
        type: "tool" as const,
        executor: "echo",
        input: { value: i },
        dependencies: i > 0 ? [`step${i - 1}`] : undefined,
      }));

      const workflow: WorkflowDefinition = {
        id: "large-dag",
        name: "Large DAG",
        description: "50-step workflow",
        mode: "dag",
        steps,
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);

      const startTime = Date.now();
      const execution = await workflowManager.executeWorkflow("large-dag");
      const duration = Date.now() - startTime;

      expect(execution.status).toBe("completed");
      expect(Object.keys(execution.stepResults)).toHaveLength(50);
      expect(duration).toBeLessThan(5000); // 应该在5秒内完成
    });

    test("并发工作流执行", async () => {
      const workflow: WorkflowDefinition = {
        id: "concurrent-test",
        name: "Concurrent Test",
        description: "Test",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "echo", input: { value: 1 } },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);

      // 同时执行10个工作流
      const executions = await Promise.all(
        Array.from({ length: 10 }, () =>
          workflowManager.executeWorkflow("concurrent-test")
        )
      );

      expect(executions).toHaveLength(10);
      executions.forEach(exec => {
        expect(exec.status).toBe("completed");
      });
    });
  });
});
