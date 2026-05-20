import { describe, test, expect } from "bun:test";
import { ComplexityAnalyzer } from "./complexity-analyzer.js";

describe("ComplexityAnalyzer", () => {
  const analyzer = new ComplexityAnalyzer();

  describe("Score Calculation", () => {
    test("simple task gets low score", () => {
      const result = analyzer.analyze("Fix typo in README");
      expect(result.score).toBeLessThan(50);
      expect(result.recommendation).toBe("direct");
    });

    test("multi-step task increases score", () => {
      const result = analyzer.analyze("Create and test new feature");
      expect(result.factors.multiStep).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(20);
    });

    test("multiple agents needed increases score", () => {
      const result = analyzer.analyze("Review and test and document the code");
      expect(result.factors.requiresMultipleAgents).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(15);
    });

    test("external dependencies increase score", () => {
      const result = analyzer.analyze("Deploy API to production");
      expect(result.factors.hasExternalDependencies).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(25);
    });

    test("approval keywords increase score", () => {
      const result = analyzer.analyze("Update config and verify changes");
      expect(result.factors.requiresApproval).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(30);
    });

    test("destructive operations increase score significantly", () => {
      const result = analyzer.analyze("Delete old database tables");
      expect(result.score).toBeGreaterThanOrEqual(40);
    });

    test("high-risk operations increase score", () => {
      const result = analyzer.analyze("Refactor production authentication");
      expect(result.score).toBeGreaterThanOrEqual(35);
    });
  });

  describe("Recommendation Threshold", () => {
    test("score <= 50 recommends direct execution", () => {
      const result = analyzer.analyze("Add console.log for debugging");
      expect(result.score).toBeLessThanOrEqual(50);
      expect(result.recommendation).toBe("direct");
      expect(result.suggestedWorkflow).toBeUndefined();
    });

    test("score > 50 recommends workflow", () => {
      const result = analyzer.analyze("Refactor authentication, add tests, and deploy to production");
      expect(result.score).toBeGreaterThan(50);
      expect(result.recommendation).toBe("workflow");
      expect(result.suggestedWorkflow).toBeDefined();
    });
  });

  describe("Duration Estimation", () => {
    test("low score estimates short duration", () => {
      const result = analyzer.analyze("Fix typo");
      expect(result.factors.estimatedDuration).toBe("short");
    });

    test("medium score estimates medium duration", () => {
      const result = analyzer.analyze("Create new API endpoint and test it");
      expect(result.score).toBeGreaterThan(40);
      expect(result.score).toBeLessThanOrEqual(70);
      expect(result.factors.estimatedDuration).toBe("medium");
    });

    test("high score estimates long duration", () => {
      const result = analyzer.analyze("Migrate database, update API, test, review, and deploy to production");
      expect(result.score).toBeGreaterThan(70);
      expect(result.factors.estimatedDuration).toBe("long");
    });
  });

  describe("Workflow Generation", () => {
    test("generates workflow with analysis step", () => {
      const result = analyzer.analyze("Refactor auth module and add tests");
      expect(result.suggestedWorkflow).toBeDefined();
      expect(result.suggestedWorkflow!.steps[0].name).toBe("Analyze Requirements");
      expect(result.suggestedWorkflow!.steps[0].type).toBe("agent");
    });

    test("includes implementation step for code tasks", () => {
      const result = analyzer.analyze("Implement user registration and deploy to production");
      expect(result.recommendation).toBe("workflow");
      const workflow = result.suggestedWorkflow!;
      const implStep = workflow.steps.find(s => s.name === "Implement Changes");
      expect(implStep).toBeDefined();
      expect(implStep!.executor).toBe("coder");
    });

    test("includes testing step for code tasks", () => {
      const result = analyzer.analyze("Create new API feature, test it thoroughly, and deploy");
      expect(result.recommendation).toBe("workflow");
      const workflow = result.suggestedWorkflow!;
      const testStep = workflow.steps.find(s => s.name === "Run Tests");
      expect(testStep).toBeDefined();
      expect(testStep!.executor).toBe("tester");
    });

    test("includes documentation step when mentioned", () => {
      const result = analyzer.analyze("Add feature, test, document it, and review");
      expect(result.recommendation).toBe("workflow");
      const workflow = result.suggestedWorkflow!;
      const docStep = workflow.steps.find(s => s.name === "Update Documentation");
      expect(docStep).toBeDefined();
      expect(docStep!.executor).toBe("documenter");
    });

    test("includes review and approval for high-risk tasks", () => {
      const result = analyzer.analyze("Deploy to production and verify");
      const workflow = result.suggestedWorkflow!;
      const reviewStep = workflow.steps.find(s => s.name === "Code Review");
      const approvalStep = workflow.steps.find(s => s.type === "approval");

      expect(reviewStep).toBeDefined();
      expect(reviewStep!.executor).toBe("reviewer");
      expect(approvalStep).toBeDefined();
      expect(approvalStep!.name).toBe("User Approval");
    });

    test("sets correct dependencies between steps", () => {
      const result = analyzer.analyze("Implement, test, and review");
      const workflow = result.suggestedWorkflow!;

      // Implementation depends on analysis
      const implStep = workflow.steps.find(s => s.name === "Implement Changes");
      expect(implStep!.dependencies).toContain("step-1");

      // Testing depends on implementation
      const testStep = workflow.steps.find(s => s.name === "Run Tests");
      expect(testStep!.dependencies).toContain(implStep!.id);
    });

    test("chooses serial mode for simple workflows", () => {
      const result = analyzer.analyze("Create simple utility function and deploy it");
      expect(result.recommendation).toBe("workflow");
      const workflow = result.suggestedWorkflow!;
      expect(workflow.mode).toBe("serial");
    });

    test("includes metadata with complexity score", () => {
      const result = analyzer.analyze("Refactor and test");
      const workflow = result.suggestedWorkflow!;
      expect(workflow.metadata).toBeDefined();
      expect(workflow.metadata!.autoGenerated).toBe(true);
      expect(workflow.metadata!.complexityScore).toBeGreaterThan(0);
    });

    test("truncates long task descriptions in workflow name", () => {
      const longTask = "Deploy " + "A".repeat(100) + " to production";
      const result = analyzer.analyze(longTask);
      expect(result.recommendation).toBe("workflow");
      const workflow = result.suggestedWorkflow!;
      expect(workflow.name.length).toBeLessThan(longTask.length);
      expect(workflow.name).toContain("...");
    });
  });

  describe("Real-World Scenarios", () => {
    test("simple bug fix - direct execution", () => {
      const result = analyzer.analyze("Fix null pointer exception in login handler");
      expect(result.recommendation).toBe("direct");
      expect(result.factors.multiStep).toBe(false);
      expect(result.factors.estimatedDuration).toBe("short");
    });

    test("feature with tests - workflow recommended", () => {
      const result = analyzer.analyze("Add user profile page, test it, and deploy");
      expect(result.recommendation).toBe("workflow");
      expect(result.factors.multiStep).toBe(true);
      const workflow = result.suggestedWorkflow!;
      expect(workflow.steps.length).toBeGreaterThanOrEqual(3);
    });

    test("production deployment - workflow with approval", () => {
      const result = analyzer.analyze("Deploy authentication changes to production and verify");
      expect(result.recommendation).toBe("workflow");
      expect(result.factors.requiresApproval).toBe(true);
      expect(result.factors.hasExternalDependencies).toBe(true);

      const workflow = result.suggestedWorkflow!;
      const approvalStep = workflow.steps.find(s => s.type === "approval");
      expect(approvalStep).toBeDefined();
    });

    test("database migration - high complexity", () => {
      const result = analyzer.analyze("Migrate user database schema and update API endpoints");
      expect(result.score).toBeGreaterThan(70);
      expect(result.factors.estimatedDuration).toBe("long");
      expect(result.factors.hasExternalDependencies).toBe(true);
    });

    test("documentation only - direct execution", () => {
      const result = analyzer.analyze("Update API documentation");
      expect(result.recommendation).toBe("direct");
      expect(result.score).toBeLessThan(50);
    });

    test("refactor with review - workflow recommended", () => {
      const result = analyzer.analyze("Refactor payment processing and review changes");
      expect(result.recommendation).toBe("workflow");
      expect(result.factors.requiresApproval).toBe(true);

      const workflow = result.suggestedWorkflow!;
      const reviewStep = workflow.steps.find(s => s.name === "Code Review");
      expect(reviewStep).toBeDefined();
    });

    test("delete operation - high score due to destructive nature", () => {
      const result = analyzer.analyze("Delete deprecated API endpoints");
      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.recommendation).toBe("workflow");
    });

    test("multi-agent coordination - workflow with multiple executors", () => {
      const result = analyzer.analyze("Implement feature, write tests, document, and review");
      expect(result.recommendation).toBe("workflow");
      expect(result.factors.requiresMultipleAgents).toBe(true);

      const workflow = result.suggestedWorkflow!;
      const executors = new Set(workflow.steps.map(s => s.executor).filter(Boolean));
      expect(executors.size).toBeGreaterThan(1);
    });
  });

  describe("Edge Cases", () => {
    test("empty task description", () => {
      const result = analyzer.analyze("");
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("direct");
    });

    test("task with no action verbs", () => {
      const result = analyzer.analyze("The system is running");
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("direct");
    });

    test("case insensitive keyword matching", () => {
      const result1 = analyzer.analyze("DEPLOY TO PRODUCTION");
      const result2 = analyzer.analyze("deploy to production");
      expect(result1.score).toBe(result2.score);
    });

    test("multiple occurrences of same keyword", () => {
      const result = analyzer.analyze("test test test");
      // Should only count once per keyword type
      expect(result.score).toBeLessThan(100);
    });

    test("context parameter is optional", () => {
      const result = analyzer.analyze("Simple task");
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Factor Detection", () => {
    test("detects multi-step correctly", () => {
      const single = analyzer.analyze("Create function");
      const multi = analyzer.analyze("Create and test function");

      expect(single.factors.multiStep).toBe(false);
      expect(multi.factors.multiStep).toBe(true);
    });

    test("detects multiple agents correctly", () => {
      const single = analyzer.analyze("Write code");
      const multi = analyzer.analyze("Write code, test it, and document it");

      expect(single.factors.requiresMultipleAgents).toBe(false);
      expect(multi.factors.requiresMultipleAgents).toBe(true);
    });

    test("detects external dependencies correctly", () => {
      const internal = analyzer.analyze("Refactor helper function");
      const external = analyzer.analyze("Update database schema");

      expect(internal.factors.hasExternalDependencies).toBe(false);
      expect(external.factors.hasExternalDependencies).toBe(true);
    });

    test("detects approval requirements correctly", () => {
      const noApproval = analyzer.analyze("Add utility function");
      const needsApproval = analyzer.analyze("Add function and verify it works");

      expect(noApproval.factors.requiresApproval).toBe(false);
      expect(needsApproval.factors.requiresApproval).toBe(true);
    });
  });
});
