import type { WorkflowDefinition, WorkflowStep } from "../types.js";
import { randomUUID } from "node:crypto";

export interface ComplexityAnalysis {
  score: number;
  factors: {
    multiStep: boolean;
    requiresMultipleAgents: boolean;
    hasExternalDependencies: boolean;
    requiresApproval: boolean;
    estimatedDuration: "short" | "medium" | "long";
  };
  recommendation: "direct" | "workflow";
  suggestedWorkflow?: WorkflowDefinition;
}

export class ComplexityAnalyzer {
  analyze(taskDescription: string, _context: Record<string, unknown> = {}): ComplexityAnalysis {
    const lowerTask = taskDescription.toLowerCase();
    let score = 0;

    // Check for multiple verbs (indicates multi-step)
    const actionVerbs = [
      "create",
      "build",
      "implement",
      "add",
      "update",
      "refactor",
      "test",
      "deploy",
      "migrate",
      "review",
      "document",
      "fix",
      "delete",
      "remove",
      "modify",
      "change",
      "optimize",
    ];
    const verbCount = actionVerbs.filter((v) => lowerTask.includes(v)).length;
    const multiStep = verbCount >= 2;
    if (multiStep) score += 20;

    // Check for multiple agents needed
    const agentKeywords = ["review", "test", "document", "architect", "debug", "optimize"];
    const requiresMultipleAgents = agentKeywords.filter((k) => lowerTask.includes(k)).length >= 2;
    if (requiresMultipleAgents) score += 15;

    // Check for external dependencies
    const externalKeywords = [
      "api",
      "database",
      "deploy",
      "migrate",
      "external",
      "service",
      "endpoint",
    ];
    const hasExternalDependencies = externalKeywords.some((k) => lowerTask.includes(k));
    if (hasExternalDependencies) score += 25;

    // Check for approval mentions
    const approvalKeywords = ["approve", "review", "verify", "confirm", "check", "validate"];
    const requiresApproval = approvalKeywords.some((k) => lowerTask.includes(k));
    if (requiresApproval) score += 30;

    // Check for destructive operations
    const destructiveKeywords = ["delete", "remove", "drop", "destroy", "reset", "clear", "purge"];
    const isDestructive = destructiveKeywords.some((k) => lowerTask.includes(k));
    if (isDestructive) score += 40;

    // Check for high-risk operations
    const riskKeywords = ["production", "prod", "live", "deploy", "migrate", "refactor"];
    const isHighRisk = riskKeywords.some((k) => lowerTask.includes(k));
    if (isHighRisk) score += 35;

    // Estimate duration based on task complexity
    let estimatedDuration: "short" | "medium" | "long" = "short";
    if (score > 70) {
      estimatedDuration = "long";
    } else if (score > 40) {
      estimatedDuration = "medium";
    }

    // Determine recommendation (threshold: 50)
    const recommendation = score > 50 ? "workflow" : "direct";

    const factors = {
      multiStep,
      requiresMultipleAgents,
      hasExternalDependencies,
      requiresApproval,
      estimatedDuration,
    };

    const suggestedWorkflow =
      recommendation === "workflow" ? this.generateWorkflow(taskDescription, factors) : undefined;

    return {
      score,
      factors,
      recommendation,
      suggestedWorkflow,
    };
  }

  private generateWorkflow(
    taskDescription: string,
    factors: ComplexityAnalysis["factors"]
  ): WorkflowDefinition {
    const steps: WorkflowStep[] = [];
    const lowerTask = taskDescription.toLowerCase();

    // Step 1: Always start with analysis
    steps.push({
      id: "step-1",
      name: "Analyze Requirements",
      type: "agent",
      executor: "hera",
    });

    // Step 2: Implementation
    if (
      lowerTask.includes("code") ||
      lowerTask.includes("implement") ||
      lowerTask.includes("create")
    ) {
      steps.push({
        id: "step-2",
        name: "Implement Changes",
        type: "agent",
        executor: "coder",
        dependencies: ["step-1"],
      });
    } else {
      steps.push({
        id: "step-2",
        name: "Execute Task",
        type: "agent",
        executor: "hera",
        dependencies: ["step-1"],
      });
    }

    // Step 3: Testing (if mentioned or if code changes)
    if (
      lowerTask.includes("test") ||
      lowerTask.includes("code") ||
      lowerTask.includes("implement")
    ) {
      steps.push({
        id: "step-3",
        name: "Run Tests",
        type: "agent",
        executor: "tester",
        dependencies: ["step-2"],
      });
    }

    // Step 4: Documentation (parallel with testing if both needed)
    if (lowerTask.includes("document") || lowerTask.includes("docs")) {
      const docStep: WorkflowStep = {
        id: steps.length === 3 ? "step-4" : "step-3",
        name: "Update Documentation",
        type: "agent",
        executor: "documenter",
        dependencies: ["step-2"],
      };
      steps.push(docStep);
    }

    // Step 5: Review (if approval needed)
    if (factors.requiresApproval) {
      const reviewStep: WorkflowStep = {
        id: `step-${steps.length + 1}`,
        name: "Code Review",
        type: "agent",
        executor: "reviewer",
        dependencies: steps.slice(2).map((s) => s.id),
      };
      steps.push(reviewStep);

      // Step 6: Approval gate
      steps.push({
        id: `step-${steps.length + 1}`,
        name: "User Approval",
        type: "approval",
        dependencies: [reviewStep.id],
      });
    }

    // Determine mode based on structure
    let mode: "serial" | "parallel" | "dag" = "serial";
    const hasParallelSteps = steps.some(
      (s) =>
        s.dependencies &&
        s.dependencies.length > 0 &&
        steps.some(
          (other) =>
            other.id !== s.id && other.dependencies?.some((d) => s.dependencies?.includes(d))
        )
    );

    if (hasParallelSteps) {
      mode = "dag";
    } else if (steps.length <= 3 && !factors.requiresApproval) {
      mode = "serial";
    }

    return {
      id: randomUUID(),
      name: `Workflow for: ${taskDescription.slice(0, 50)}${taskDescription.length > 50 ? "..." : ""}`,
      description: `Auto-generated workflow for task: ${taskDescription}`,
      mode,
      steps,
      createdAt: Date.now(),
      metadata: {
        autoGenerated: true,
        complexityScore: this.calculateScore(factors),
      },
    };
  }

  private calculateScore(factors: ComplexityAnalysis["factors"]): number {
    let score = 0;
    if (factors.multiStep) score += 20;
    if (factors.requiresMultipleAgents) score += 15;
    if (factors.hasExternalDependencies) score += 25;
    if (factors.requiresApproval) score += 30;
    if (factors.estimatedDuration === "long") score += 20;
    else if (factors.estimatedDuration === "medium") score += 10;
    return score;
  }
}
