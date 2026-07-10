import type { MemoryStore } from "../memory/store.js";
import type { TeamManager } from "../team/manager.js";
import type { OpenCodeClient } from "../types/client.js";
import type {
  WorkflowContext,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
} from "../types.js";
import { randomUUID } from "node:crypto";
import { WorkflowNotFoundError, WorkflowExecutionError } from "../errors.js";
import { WorkflowValidator } from "./validator.js";
import { WorkflowProgressCallback, ConcurrencyLimiter } from "./progress.js";
import { heraLog } from "../logger.js";
import { MAX_CONCURRENT_WORKFLOWS, TEAM_POLL_INTERVAL_MS } from "../constants.js";

export class WorkflowManager {
  private store: MemoryStore;
  private teamManager: TeamManager;
  private client: OpenCodeClient | undefined;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private activeExecutions = 0;
  // Agent-step sessions created but not yet completed. Retained on
  // timeout/error so they can be reconciled or aborted later, cleared on
  // successful completion.
  private pendingSessions: Set<string> = new Set();

  // Resource management
  private readonly MAX_EXECUTION_HISTORY = 1000;
  private readonly EXECUTION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_PARALLEL_STEPS = 10; // Limit concurrent step execution

  constructor(store: MemoryStore, teamManager: TeamManager, client: OpenCodeClient | undefined) {
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
    // Validate workflow before creating
    WorkflowValidator.validateOrThrow(def);

    this.workflows.set(def.id, def);
    await this.store.save({
      id: `workflow-${def.id}`,
      type: "workflow",
      content: JSON.stringify(def),
      timestamp: Date.now(),
      metadata: { mode: def.mode, stepCount: def.steps.length },
    });

    heraLog("info", `Created workflow: ${def.id} (${def.mode} mode, ${def.steps.length} steps)`);
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    this.workflows.delete(id);
    return this.store.delete("workflow", `workflow-${id}`);
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  getAllWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  async executeWorkflow(
    workflowId: string,
    context: WorkflowContext = {},
    callbacks?: WorkflowProgressCallback
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    if (this.activeExecutions >= MAX_CONCURRENT_WORKFLOWS) {
      throw new WorkflowExecutionError(
        workflowId,
        "entry",
        new Error(`Maximum concurrent workflows (${MAX_CONCURRENT_WORKFLOWS}) reached`)
      );
    }

    const executionId = randomUUID();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: "running",
      stepResults: {},
      context,
      startedAt: Date.now(),
    };

    this.executions.set(executionId, execution);
    this.activeExecutions++;

    heraLog("info", `Starting workflow execution: ${workflowId} (${workflow.mode} mode)`);

    try {
      switch (workflow.mode) {
        case "serial":
          await this.executeSerialWorkflow(workflow, context, execution, callbacks);
          break;
        case "parallel":
          await this.executeParallelWorkflow(workflow, context, execution, callbacks);
          break;
        case "dag":
          await this.executeDAGWorkflow(workflow, context, execution, callbacks);
          break;
        default:
          throw new Error(`Unknown workflow mode: ${workflow.mode}`);
      }

      execution.status = "completed";
      execution.completedAt = Date.now();
      execution.context = context;

      heraLog(
        "info",
        `Workflow completed: ${workflowId} in ${execution.completedAt - execution.startedAt}ms`
      );

      return execution;
    } catch (error) {
      const workflowError = error instanceof Error ? error : new Error(String(error));
      execution.status = "failed";
      execution.error = workflowError.message;
      execution.completedAt = Date.now();

      heraLog("warn", `Workflow failed: ${workflowId}`, workflowError.message);

      throw new WorkflowExecutionError(
        workflowId,
        execution.currentStep || "unknown",
        workflowError
      );
    } finally {
      this.activeExecutions--;
      await this.cleanupOldExecutions();
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
    context: WorkflowContext,
    execution: WorkflowExecution,
    callbacks?: WorkflowProgressCallback
  ): Promise<Record<string, unknown>> {
    let currentContext = { ...context };
    let completedSteps = 0;
    const totalSteps = workflow.steps.length;

    for (const step of workflow.steps) {
      if (execution.status === "paused") {
        await this.waitForResume(execution.id);
      }

      execution.currentStep = step.id;
      callbacks?.onStepStart?.(step.id, step.name, step);

      if (step.condition && !this.evaluateCondition(step.condition, currentContext)) {
        heraLog("debug", `Skipping step ${step.id} due to condition: ${step.condition}`);
        continue;
      }

      const stepStart = Date.now();
      try {
        const result = await this.executeStep(step, currentContext);
        const duration = Date.now() - stepStart;

        execution.stepResults[step.id] = result;
        currentContext = { ...currentContext, [step.id]: result };

        callbacks?.onStepComplete?.(step.id, {
          status: "success",
          output: result,
          duration,
          timestamp: Date.now(),
        });

        completedSteps++;
        callbacks?.onWorkflowProgress?.(
          completedSteps,
          totalSteps,
          (completedSteps / totalSteps) * 100
        );
      } catch (error) {
        callbacks?.onStepError?.(step.id, error as Error, false);
        throw error;
      }
    }

    return execution.stepResults;
  }

  private async executeParallelWorkflow(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    execution: WorkflowExecution,
    callbacks?: WorkflowProgressCallback
  ): Promise<Record<string, unknown>> {
    const limiter = new ConcurrencyLimiter(this.MAX_PARALLEL_STEPS);
    let completedSteps = 0;
    const totalSteps = workflow.steps.length;

    const promises = workflow.steps.map(async (step) => {
      return limiter.run(async () => {
        callbacks?.onStepStart?.(step.id, step.name, step);

        if (step.condition && !this.evaluateCondition(step.condition, context)) {
          heraLog("debug", `Skipping step ${step.id} due to condition: ${step.condition}`);
          return null;
        }

        const stepStart = Date.now();
        try {
          const result = await this.executeStep(step, context);
          const duration = Date.now() - stepStart;

          execution.stepResults[step.id] = result;

          callbacks?.onStepComplete?.(step.id, {
            status: "success",
            output: result,
            duration,
            timestamp: Date.now(),
          });

          completedSteps++;
          callbacks?.onWorkflowProgress?.(
            completedSteps,
            totalSteps,
            (completedSteps / totalSteps) * 100
          );

          return { stepId: step.id, result };
        } catch (error) {
          callbacks?.onStepError?.(step.id, error as Error, false);
          throw error;
        }
      });
    });

    await Promise.all(promises);
    return execution.stepResults;
  }

  private async executeDAGWorkflow(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    execution: WorkflowExecution,
    callbacks?: WorkflowProgressCallback
  ): Promise<Record<string, unknown>> {
    const dag = this.buildDAG(workflow.steps);
    const sorted = this.topologicalSort(dag);
    const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
    const currentContext = { ...context };

    // Group steps by wave (steps with same depth can run in parallel)
    const waves = this.groupByWaves(sorted, dag);
    const limiter = new ConcurrencyLimiter(this.MAX_PARALLEL_STEPS);

    let completedSteps = 0;
    const totalSteps = workflow.steps.length;

    for (const wave of waves) {
      if (execution.status === "paused") {
        await this.waitForResume(execution.id);
      }

      const promises = wave.map(async (stepId) => {
        return limiter.run(async () => {
          const step = stepMap.get(stepId);
          if (!step) return null;

          execution.currentStep = stepId;
          callbacks?.onStepStart?.(stepId, step.name, step);

          if (step.condition && !this.evaluateCondition(step.condition, currentContext)) {
            heraLog("debug", `Skipping step ${stepId} due to condition: ${step.condition}`);
            return null;
          }

          const stepStart = Date.now();
          try {
            const result = await this.executeStep(step, currentContext);
            const duration = Date.now() - stepStart;

            execution.stepResults[stepId] = result;

            callbacks?.onStepComplete?.(stepId, {
              status: "success",
              output: result,
              duration,
              timestamp: Date.now(),
            });

            completedSteps++;
            callbacks?.onWorkflowProgress?.(
              completedSteps,
              totalSteps,
              (completedSteps / totalSteps) * 100
            );

            return { stepId, result };
          } catch (error) {
            callbacks?.onStepError?.(stepId, error as Error, false);
            throw error;
          }
        });
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

  private async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
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
    context: WorkflowContext,
    timeoutMs: number
  ): Promise<unknown> {
    return Promise.race([
      this.executeStepInternal(step, context),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Step timeout: ${step.id}`)), timeoutMs)
      ),
    ]);
  }

  private async executeStepInternal(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<unknown> {
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

  private async executeAgentStep(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    if (!this.client) {
      throw new Error("OpenCode client not available for agent execution");
    }

    const agentName = step.executor || "hera";
    const input = step.input || context;
    const prompt = typeof input === "string" ? input : JSON.stringify(input);

    // Create session and execute
    const session = await this.client.session.create({
      body: { title: `Hera workflow step: ${step.name}` },
      query: { directory: process.cwd() },
    });

    const sessionId = session.data?.id;
    if (!sessionId) {
      throw new Error("OpenCode session creation failed");
    }

    this.pendingSessions.add(sessionId);

    // promptAsync only acknowledges acceptance (it resolves 202/204 void); it
    // does NOT wait for the agent nor carry the assistant's output. Poll the
    // session until it goes idle and return the real assistant text so
    // downstream steps reading context[stepId] see actual output.
    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: agentName,
        parts: [{ type: "text" as const, text: prompt }],
      },
    });

    const timeoutMs = step.timeout || 300000; // bound by step.timeout
    const result = await this.pollAgentSession(sessionId, timeoutMs);
    this.pendingSessions.delete(sessionId);
    return result;
  }

  /**
   * Poll an agent session until it becomes idle, then return the last
   * assistant message's text. Mirrors TeamManager.pollSessionCompletion.
   * Bounded by `timeoutMs` so the step retry/timeout machinery still applies.
   * Throws (rather than returning a misleading ack) on timeout, on a missing
   * poll API, or when an idle session produced no assistant output. The session
   * id remains tracked in `pendingSessions` on failure for later reconciliation.
   */
  private async pollAgentSession(sessionId: string, timeoutMs: number): Promise<string> {
    if (!this.client) {
      throw new Error("OpenCode client not available for agent execution");
    }
    const sessionApi = this.client.session;
    if (typeof sessionApi.status !== "function" || typeof sessionApi.messages !== "function") {
      throw new Error(
        "OpenCode client lacks session.status/messages; cannot await agent step completion"
      );
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let statusType: string | undefined;
      try {
        const statusResult = await sessionApi.status();
        statusType = statusResult.data?.[sessionId]?.type;
      } catch {
        statusType = undefined; // transient error — keep polling until deadline
      }

      if (statusType === "idle") {
        const messagesResult = await sessionApi.messages({ path: { id: sessionId } });
        const messages = messagesResult.data ?? [];
        for (let j = messages.length - 1; j >= 0; j--) {
          const message = messages[j];
          if (message?.info.role === "assistant") {
            return message.parts?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
          }
        }
        // Idle but no assistant message: not a genuine completion.
        throw new Error(
          `Agent session ${sessionId} became idle without producing assistant output`
        );
      }

      await new Promise((r) => setTimeout(r, TEAM_POLL_INTERVAL_MS));
    }

    throw new Error(`Agent step timed out waiting for session ${sessionId}`);
  }

  /**
   * Agent-step session ids that were created but have not completed, exposed
   * for crash recovery / reconciliation and abort of orphaned sessions.
   */
  getPendingAgentSessions(): string[] {
    return Array.from(this.pendingSessions);
  }

  private async executeToolStep(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    // Tool execution would require access to tool registry
    // For now, return a placeholder
    return { tool: step.executor, input: step.input || context };
  }

  private async executeDecisionStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<boolean> {
    if (!step.condition) {
      throw new Error(`Decision step requires condition: ${step.id}`);
    }
    return this.evaluateCondition(step.condition, context);
  }

  private async executeApprovalStep(
    step: WorkflowStep,
    context: WorkflowContext
  ): Promise<{
    type: "approval_required";
    step: string;
    context: WorkflowContext;
    message: string;
  }> {
    // Approval step returns a request for user approval
    // The actual approval mechanism is handled by hera_request_approval tool
    return {
      type: "approval_required",
      step: step.id,
      context,
      message: `Approval required for step: ${step.name}`,
    };
  }

  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
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

  /**
   * Clean up old completed executions to prevent memory leaks
   */
  async cleanupOldExecutions(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, execution] of this.executions.entries()) {
      const age = now - execution.startedAt;
      const isCompleted = execution.status === "completed" || execution.status === "failed";

      if (isCompleted && age > this.EXECUTION_TTL_MS) {
        this.executions.delete(id);
        cleaned++;
      }
    }

    // If still over limit, delete oldest completed executions
    if (this.executions.size > this.MAX_EXECUTION_HISTORY) {
      const completed = Array.from(this.executions.entries())
        .filter(([_, e]) => e.status === "completed" || e.status === "failed")
        .sort((a, b) => a[1].startedAt - b[1].startedAt);

      const toDelete = completed.slice(0, this.executions.size - this.MAX_EXECUTION_HISTORY);
      toDelete.forEach(([id]) => {
        this.executions.delete(id);
        cleaned++;
      });
    }

    if (cleaned > 0) {
      heraLog("debug", `Cleaned up ${cleaned} old workflow executions`);
    }

    return cleaned;
  }

  /**
   * Get execution statistics
   */
  getExecutionStats() {
    const executions = Array.from(this.executions.values());
    return {
      total: executions.length,
      running: executions.filter((e) => e.status === "running").length,
      completed: executions.filter((e) => e.status === "completed").length,
      failed: executions.filter((e) => e.status === "failed").length,
      paused: executions.filter((e) => e.status === "paused").length,
    };
  }
}
