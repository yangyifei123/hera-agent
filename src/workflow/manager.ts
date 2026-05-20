import type { MemoryStore } from "../memory/store.js";
import type { TeamManager } from "../team/manager.js";
import type { OpenCodeClient } from "../types/client.js";
import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
  WorkflowMode,
} from "../types.js";
import { randomUUID } from "node:crypto";

export class WorkflowManager {
  private store: MemoryStore;
  private teamManager: TeamManager;
  private client: OpenCodeClient | undefined;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();

  constructor(
    store: MemoryStore,
    teamManager: TeamManager,
    client: OpenCodeClient | undefined
  ) {
    this.store = store;
    this.teamManager = teamManager;
    this.client = client;
  }

  async init(): Promise<void> {
    const stored = await this.store.list("workflow");
    for (const mem of stored) {
      try {
        const workflow = JSON.parse(mem.content) as WorkflowDefinition;
        this.workflows.set(workflow.id, workflow);
      } catch {
        // skip invalid workflows
      }
    }
  }

  async createWorkflow(def: WorkflowDefinition): Promise<void> {
    this.workflows.set(def.id, def);
    await this.store.save({
      id: `workflow-${def.id}`,
      type: "workflow" as any,
      content: JSON.stringify(def),
      timestamp: Date.now(),
      metadata: { mode: def.mode, stepCount: def.steps.length },
    });
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    this.workflows.delete(id);
    return this.store.delete("workflow" as any, `workflow-${id}`);
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  getAllWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  async executeWorkflow(
    workflowId: string,
    context: Record<string, any> = {}
  ): Promise<any> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const executionId = randomUUID();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: "running",
      stepResults: {},
      startedAt: Date.now(),
    };

    this.executions.set(executionId, execution);

    try {
      let result: any;
      switch (workflow.mode) {
        case "serial":
          result = await this.executeSerialWorkflow(workflow, context, execution);
          break;
        case "parallel":
          result = await this.executeParallelWorkflow(workflow, context, execution);
          break;
        case "dag":
          result = await this.executeDAGWorkflow(workflow, context, execution);
          break;
        default:
          throw new Error(`Unknown workflow mode: ${workflow.mode}`);
      }

      execution.status = "completed";
      execution.completedAt = Date.now();
      execution.context = context;
      return execution;
    } catch (error) {
      execution.status = "failed";
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completedAt = Date.now();
      throw error;
    }
  }

  async pauseWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    execution.status = "paused";
  }

  async resumeWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    if (execution.status !== "paused") {
      throw new Error(`Execution is not paused: ${executionId}`);
    }
    execution.status = "running";
  }

  getExecutionStatus(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  private async executeSerialWorkflow(
    workflow: WorkflowDefinition,
    context: Record<string, any>,
    execution: WorkflowExecution
  ): Promise<any> {
    let currentContext = { ...context };

    for (const step of workflow.steps) {
      if (execution.status === "paused") {
        await this.waitForResume(execution.id);
      }

      execution.currentStep = step.id;

      if (step.condition && !this.evaluateCondition(step.condition, currentContext)) {
        continue;
      }

      const result = await this.executeStep(step, currentContext);
      execution.stepResults[step.id] = result;
      currentContext = { ...currentContext, [step.id]: result };
    }

    return execution.stepResults;
  }

  private async executeParallelWorkflow(
    workflow: WorkflowDefinition,
    context: Record<string, any>,
    execution: WorkflowExecution
  ): Promise<any> {
    const promises = workflow.steps.map(async (step) => {
      if (step.condition && !this.evaluateCondition(step.condition, context)) {
        return null;
      }

      const result = await this.executeStep(step, context);
      execution.stepResults[step.id] = result;
      return { stepId: step.id, result };
    });

    await Promise.all(promises);
    return execution.stepResults;
  }

  private async executeDAGWorkflow(
    workflow: WorkflowDefinition,
    context: Record<string, any>,
    execution: WorkflowExecution
  ): Promise<any> {
    const dag = this.buildDAG(workflow.steps);
    const sorted = this.topologicalSort(dag);
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
    let currentContext = { ...context };

    // Group steps by wave (steps with same depth can run in parallel)
    const waves = this.groupByWaves(sorted, dag);

    for (const wave of waves) {
      if (execution.status === "paused") {
        await this.waitForResume(execution.id);
      }

      const promises = wave.map(async (stepId) => {
        const step = stepMap.get(stepId);
        if (!step) return null;

        execution.currentStep = stepId;

        if (step.condition && !this.evaluateCondition(step.condition, currentContext)) {
          return null;
        }

        const result = await this.executeStep(step, currentContext);
        execution.stepResults[stepId] = result;
        return { stepId, result };
      });

      const results = await Promise.all(promises);
      for (const res of results) {
        if (res) {
          currentContext[res.stepId] = res.result;
        }
      }
    }

    return execution.stepResults;
  }

  private async executeStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    const maxAttempts = step.retryPolicy?.maxAttempts || 1;
    const backoffMs = step.retryPolicy?.backoffMs || 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const timeoutMs = step.timeout || 300000; // 5 minutes default
        const result = await this.executeStepWithTimeout(step, context, timeoutMs);
        return result;
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
      }
    }
  }

  private async executeStepWithTimeout(
    step: WorkflowStep,
    context: Record<string, any>,
    timeoutMs: number
  ): Promise<any> {
    return Promise.race([
      this.executeStepInternal(step, context),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Step timeout: ${step.id}`)), timeoutMs)
      ),
    ]);
  }

  private async executeStepInternal(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    switch (step.type) {
      case "agent":
        return this.executeAgentStep(step, context);
      case "tool":
        return this.executeToolStep(step, context);
      case "decision":
        return this.executeDecisionStep(step, context);
      case "approval":
        return this.executeApprovalStep(step, context);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async executeAgentStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    if (!this.client) {
      throw new Error("OpenCode client not available for agent execution");
    }

    const agentName = step.executor || "hera";
    const input = step.input || context;
    const prompt = typeof input === "string" ? input : JSON.stringify(input);

    // Create session and execute
    const session = await this.client.session.create({
      agent: agentName,
      directory: process.cwd(),
    });

    const response = await this.client.session.promptAsync(session.id, prompt);
    return response;
  }

  private async executeToolStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    // Tool execution would require access to tool registry
    // For now, return a placeholder
    return { tool: step.executor, input: step.input || context };
  }

  private async executeDecisionStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    if (!step.condition) {
      throw new Error(`Decision step requires condition: ${step.id}`);
    }
    return this.evaluateCondition(step.condition, context);
  }

  private async executeApprovalStep(
    step: WorkflowStep,
    context: Record<string, any>
  ): Promise<any> {
    // Approval step returns a request for user approval
    // The actual approval mechanism is handled by hera_request_approval tool
    return {
      type: "approval_required",
      step: step.id,
      context,
      message: `Approval required for step: ${step.name}`,
    };
  }

  private evaluateCondition(condition: string, context: Record<string, any>): boolean {
    // Simple condition evaluation (supports basic comparisons)
    // Format: "key==value", "key>value", "key<value", "key>=value", "key<=value", "key"
    try {
      if (condition.includes("==")) {
        const [key, value] = condition.split("==").map((s) => s.trim());
        return String(context[key]) === value;
      }
      if (condition.includes(">=")) {
        const [key, value] = condition.split(">=").map((s) => s.trim());
        return Number(context[key]) >= Number(value);
      }
      if (condition.includes("<=")) {
        const [key, value] = condition.split("<=").map((s) => s.trim());
        return Number(context[key]) <= Number(value);
      }
      if (condition.includes(">")) {
        const [key, value] = condition.split(">").map((s) => s.trim());
        return Number(context[key]) > Number(value);
      }
      if (condition.includes("<")) {
        const [key, value] = condition.split("<").map((s) => s.trim());
        return Number(context[key]) < Number(value);
      }
      // Truthy check
      return Boolean(context[condition.trim()]);
    } catch {
      return false;
    }
  }

  private buildDAG(steps: WorkflowStep[]): Map<string, string[]> {
    const dag = new Map<string, string[]>();
    for (const step of steps) {
      dag.set(step.id, step.dependencies || []);
    }
    return dag;
  }

  private topologicalSort(dag: Map<string, string[]>): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (node: string) => {
      if (visited.has(node)) return;
      if (visiting.has(node)) {
        throw new Error(`Circular dependency detected: ${node}`);
      }

      visiting.add(node);
      const deps = dag.get(node) || [];
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(node);
      visited.add(node);
      sorted.push(node);
    };

    for (const node of dag.keys()) {
      visit(node);
    }

    return sorted;
  }

  private groupByWaves(sorted: string[], dag: Map<string, string[]>): string[][] {
    const waves: string[][] = [];
    const processed = new Set<string>();

    while (processed.size < sorted.length) {
      const wave: string[] = [];
      for (const node of sorted) {
        if (processed.has(node)) continue;

        const deps = dag.get(node) || [];
        const allDepsProcessed = deps.every((dep) => processed.has(dep));

        if (allDepsProcessed) {
          wave.push(node);
        }
      }

      if (wave.length === 0) {
        throw new Error("Unable to resolve dependencies");
      }

      waves.push(wave);
      wave.forEach((node) => processed.add(node));
    }

    return waves;
  }

  private async waitForResume(executionId: string): Promise<void> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const execution = this.executions.get(executionId);
        if (execution && execution.status === "running") {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });
  }
}
