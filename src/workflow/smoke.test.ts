import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WorkflowManager } from "./manager.js";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "../team/manager.js";
import type { WorkflowDefinition } from "../types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isApprovalResult(value: unknown): value is { type: "approval_required" } {
  return typeof value === "object" && value !== null && "type" in value;
}

describe("Workflow Smoke Tests", () => {
  let tempDir: string;
  let store: MemoryStore;
  let workflowManager: WorkflowManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hera-workflow-smoke-"));
    store = new MemoryStore(tempDir);
    await store.init();

    const teamManager = new TeamManager(store, undefined);
    workflowManager = new WorkflowManager(store, teamManager, undefined);
    await workflowManager.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("End-to-End Scenarios", () => {
    test("complete software development workflow", async () => {
      // Simulate a full dev workflow: plan → code → test → review → deploy
      const workflow: WorkflowDefinition = {
        id: "dev-workflow",
        name: "Software Development",
        description: "Complete development lifecycle",
        mode: "serial",
        steps: [
          { id: "plan", name: "Planning", type: "tool", executor: "planner" },
          { id: "code", name: "Implementation", type: "tool", executor: "coder" },
          { id: "test", name: "Testing", type: "tool", executor: "tester" },
          { id: "review", name: "Code Review", type: "approval" },
          { id: "deploy", name: "Deployment", type: "tool", executor: "deployer" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("dev-workflow", {
        feature: "user-authentication",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(5);
      expect(result.stepResults.plan).toBeDefined();
      expect(result.stepResults.deploy).toBeDefined();
    });

    test("parallel code review workflow", async () => {
      // Multiple reviewers check different aspects in parallel
      const workflow: WorkflowDefinition = {
        id: "review-workflow",
        name: "Parallel Code Review",
        description: "Multi-aspect code review",
        mode: "parallel",
        steps: [
          { id: "style", name: "Style Check", type: "tool", executor: "linter" },
          { id: "security", name: "Security Scan", type: "tool", executor: "security" },
          { id: "performance", name: "Performance Analysis", type: "tool", executor: "profiler" },
          { id: "logic", name: "Logic Review", type: "tool", executor: "reviewer" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("review-workflow", {
        pr: "123",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(4);
      // All steps should complete
      expect(result.stepResults.style).toBeDefined();
      expect(result.stepResults.security).toBeDefined();
      expect(result.stepResults.performance).toBeDefined();
      expect(result.stepResults.logic).toBeDefined();
    });

    test("complex DAG workflow with multiple dependencies", async () => {
      // Build system: setup → (compile + lint) → (test + docs) → package
      const workflow: WorkflowDefinition = {
        id: "build-workflow",
        name: "Build System",
        description: "Complex build pipeline",
        mode: "dag",
        steps: [
          { id: "setup", name: "Setup", type: "tool", executor: "setup" },
          {
            id: "compile",
            name: "Compile",
            type: "tool",
            executor: "compiler",
            dependencies: ["setup"],
          },
          { id: "lint", name: "Lint", type: "tool", executor: "linter", dependencies: ["setup"] },
          { id: "test", name: "Test", type: "tool", executor: "tester", dependencies: ["compile"] },
          {
            id: "docs",
            name: "Generate Docs",
            type: "tool",
            executor: "docgen",
            dependencies: ["compile"],
          },
          {
            id: "package",
            name: "Package",
            type: "tool",
            executor: "packager",
            dependencies: ["test", "docs", "lint"],
          },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("build-workflow", {
        version: "1.0.0",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(6);

      // Verify all steps completed
      expect(result.stepResults.setup).toBeDefined();
      expect(result.stepResults.compile).toBeDefined();
      expect(result.stepResults.test).toBeDefined();
      expect(result.stepResults.docs).toBeDefined();
      expect(result.stepResults.lint).toBeDefined();
      expect(result.stepResults.package).toBeDefined();
    });

    test("workflow with conditional steps", async () => {
      // Deploy workflow with environment-specific steps
      const workflow: WorkflowDefinition = {
        id: "deploy-workflow",
        name: "Conditional Deploy",
        description: "Deploy with environment checks",
        mode: "serial",
        steps: [
          { id: "build", name: "Build", type: "tool", executor: "builder" },
          {
            id: "staging",
            name: "Deploy to Staging",
            type: "tool",
            executor: "deployer",
            condition: "env==staging",
          },
          {
            id: "prod-check",
            name: "Production Check",
            type: "approval",
            condition: "env==production",
          },
          {
            id: "prod",
            name: "Deploy to Production",
            type: "tool",
            executor: "deployer",
            condition: "env==production",
          },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);

      // Test staging deployment
      const stagingResult = await workflowManager.executeWorkflow("deploy-workflow", {
        env: "staging",
      });

      expect(stagingResult.status).toBe("completed");
      expect(stagingResult.stepResults.build).toBeDefined();
      expect(stagingResult.stepResults.staging).toBeDefined();
      // Production steps should be skipped
      expect(stagingResult.stepResults["prod-check"]).toBeUndefined();
      expect(stagingResult.stepResults.prod).toBeUndefined();
    });

    test("workflow with approval gates", async () => {
      // Critical workflow requiring multiple approvals
      const workflow: WorkflowDefinition = {
        id: "critical-workflow",
        name: "Critical Operation",
        description: "Multi-approval workflow",
        mode: "serial",
        steps: [
          { id: "prepare", name: "Prepare", type: "tool", executor: "prep" },
          { id: "review1", name: "Technical Review", type: "approval" },
          { id: "execute", name: "Execute", type: "tool", executor: "executor" },
          { id: "review2", name: "Final Review", type: "approval" },
          { id: "finalize", name: "Finalize", type: "tool", executor: "finalizer" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("critical-workflow", {
        operation: "database-migration",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(5);

      // Verify approval steps were executed
      const review1 = result.stepResults.review1;
      const review2 = result.stepResults.review2;
      if (!isApprovalResult(review1) || !isApprovalResult(review2)) {
        throw new Error("Expected approval step results");
      }
      expect(review1.type).toBe("approval_required");
      expect(review2.type).toBe("approval_required");
    });

    test("workflow persistence and recovery", async () => {
      // Create workflow, execute partially, then recover
      const workflow: WorkflowDefinition = {
        id: "persist-workflow",
        name: "Persistence Test",
        description: "Test workflow persistence",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
          { id: "step3", name: "Step 3", type: "tool", executor: "tool3" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);

      // Execute workflow
      const result = await workflowManager.executeWorkflow("persist-workflow", {});
      const executionId = result.id;

      // Verify workflow was persisted
      const retrieved = workflowManager.getWorkflow("persist-workflow");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("Persistence Test");

      // Verify execution status is available
      const status = workflowManager.getExecutionStatus(executionId);
      expect(status).toBeDefined();
      expect(status!.status).toBe("completed");
    });

    test("workflow with timeout handling", async () => {
      // Workflow with step timeouts
      const workflow: WorkflowDefinition = {
        id: "timeout-workflow",
        name: "Timeout Test",
        description: "Test timeout handling",
        mode: "serial",
        steps: [
          { id: "fast", name: "Fast Step", type: "tool", executor: "fast", timeout: 5000 },
          { id: "slow", name: "Slow Step", type: "tool", executor: "slow", timeout: 100 },
          { id: "final", name: "Final Step", type: "tool", executor: "final" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("timeout-workflow", {});

      // First step should complete
      expect(result.stepResults.fast).toBeDefined();

      // Workflow should handle timeout gracefully
      expect(result.status).toBeDefined();
    });

    test("workflow execution with context propagation", async () => {
      // Verify context is passed through workflow steps
      const workflow: WorkflowDefinition = {
        id: "context-workflow",
        name: "Context Propagation",
        description: "Test context passing",
        mode: "serial",
        steps: [
          { id: "init", name: "Initialize", type: "tool", executor: "init" },
          { id: "process", name: "Process", type: "tool", executor: "processor" },
          { id: "finalize", name: "Finalize", type: "tool", executor: "finalizer" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const initialContext = {
        userId: "user123",
        sessionId: "session456",
        timestamp: Date.now(),
      };

      const result = await workflowManager.executeWorkflow("context-workflow", initialContext);

      expect(result.status).toBe("completed");
      expect(result.context).toBeDefined();
      expect(result.context.userId).toBe("user123");
      expect(result.context.sessionId).toBe("session456");
    });

    test("multiple concurrent workflow executions", async () => {
      // Test running multiple workflows simultaneously
      const workflow1: WorkflowDefinition = {
        id: "concurrent-1",
        name: "Concurrent Workflow 1",
        description: "First concurrent workflow",
        mode: "serial",
        steps: [
          { id: "step1", name: "Step 1", type: "tool", executor: "tool1" },
          { id: "step2", name: "Step 2", type: "tool", executor: "tool2" },
        ],
        createdAt: Date.now(),
      };

      const workflow2: WorkflowDefinition = {
        id: "concurrent-2",
        name: "Concurrent Workflow 2",
        description: "Second concurrent workflow",
        mode: "parallel",
        steps: [
          { id: "stepA", name: "Step A", type: "tool", executor: "toolA" },
          { id: "stepB", name: "Step B", type: "tool", executor: "toolB" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow1);
      await workflowManager.createWorkflow(workflow2);

      // Execute both workflows concurrently
      const [result1, result2] = await Promise.all([
        workflowManager.executeWorkflow("concurrent-1", { id: 1 }),
        workflowManager.executeWorkflow("concurrent-2", { id: 2 }),
      ]);

      expect(result1.status).toBe("completed");
      expect(result2.status).toBe("completed");
      expect(result1.id).not.toBe(result2.id);
    });

    test("workflow deletion and cleanup", async () => {
      // Test workflow lifecycle: create → execute → delete
      const workflow: WorkflowDefinition = {
        id: "cleanup-workflow",
        name: "Cleanup Test",
        description: "Test cleanup",
        mode: "serial",
        steps: [{ id: "step1", name: "Step 1", type: "tool", executor: "tool1" }],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      await workflowManager.executeWorkflow("cleanup-workflow", {});

      // Verify workflow exists
      let retrieved = workflowManager.getWorkflow("cleanup-workflow");
      expect(retrieved).toBeDefined();

      // Delete workflow
      const deleted = await workflowManager.deleteWorkflow("cleanup-workflow");
      expect(deleted).toBe(true);

      // Verify workflow is gone
      retrieved = workflowManager.getWorkflow("cleanup-workflow");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("Real-World Scenarios", () => {
    test("CI/CD pipeline workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "cicd-pipeline",
        name: "CI/CD Pipeline",
        description: "Complete CI/CD workflow",
        mode: "dag",
        steps: [
          { id: "checkout", name: "Checkout Code", type: "tool", executor: "git" },
          {
            id: "install",
            name: "Install Dependencies",
            type: "tool",
            executor: "npm",
            dependencies: ["checkout"],
          },
          { id: "lint", name: "Lint", type: "tool", executor: "eslint", dependencies: ["install"] },
          {
            id: "test",
            name: "Run Tests",
            type: "tool",
            executor: "jest",
            dependencies: ["install"],
          },
          {
            id: "build",
            name: "Build",
            type: "tool",
            executor: "webpack",
            dependencies: ["lint", "test"],
          },
          {
            id: "security",
            name: "Security Scan",
            type: "tool",
            executor: "snyk",
            dependencies: ["build"],
          },
          { id: "approve", name: "Approve Deploy", type: "approval", dependencies: ["security"] },
          {
            id: "deploy",
            name: "Deploy",
            type: "tool",
            executor: "k8s",
            dependencies: ["approve"],
          },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("cicd-pipeline", {
        branch: "main",
        commit: "abc123",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(8);
    });

    test("data processing pipeline", async () => {
      const workflow: WorkflowDefinition = {
        id: "data-pipeline",
        name: "Data Processing Pipeline",
        description: "ETL workflow",
        mode: "serial",
        steps: [
          { id: "extract", name: "Extract Data", type: "tool", executor: "extractor" },
          { id: "validate", name: "Validate Data", type: "tool", executor: "validator" },
          { id: "transform", name: "Transform Data", type: "tool", executor: "transformer" },
          { id: "load", name: "Load Data", type: "tool", executor: "loader" },
          { id: "verify", name: "Verify Load", type: "tool", executor: "verifier" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("data-pipeline", {
        source: "s3://data-bucket",
        destination: "postgres://db",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(5);
    });

    test("incident response workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "incident-response",
        name: "Incident Response",
        description: "Handle production incident",
        mode: "serial",
        steps: [
          { id: "detect", name: "Detect Issue", type: "tool", executor: "monitor" },
          { id: "notify", name: "Notify Team", type: "tool", executor: "slack" },
          { id: "diagnose", name: "Diagnose", type: "tool", executor: "debugger" },
          { id: "approve-fix", name: "Approve Fix", type: "approval" },
          { id: "apply-fix", name: "Apply Fix", type: "tool", executor: "deployer" },
          { id: "verify", name: "Verify Resolution", type: "tool", executor: "verifier" },
          { id: "postmortem", name: "Create Postmortem", type: "tool", executor: "documenter" },
        ],
        createdAt: Date.now(),
      };

      await workflowManager.createWorkflow(workflow);
      const result = await workflowManager.executeWorkflow("incident-response", {
        severity: "high",
        service: "api-gateway",
      });

      expect(result.status).toBe("completed");
      expect(Object.keys(result.stepResults)).toHaveLength(7);
    });
  });
});
