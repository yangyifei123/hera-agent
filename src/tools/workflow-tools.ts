import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { PluginContext } from "../types.js";
import type { WorkflowDefinition, WorkflowStep } from "../types.js";
import { randomUUID } from "node:crypto";

function toolResult<T extends Record<string, unknown>>(data: T) {
  return {
    ...data,
    output: JSON.stringify(data, null, 2),
    metadata: data,
  };
}

export function createWorkflowTools(ctx: PluginContext) {
  // Helper functions
  function estimateExecutionTime(workflow: WorkflowDefinition): string {
    const stepCount = workflow.steps.length;
    if (workflow.mode === "parallel") {
      return "1-3 minutes";
    } else if (workflow.mode === "serial") {
      return `${stepCount * 2}-${stepCount * 5} minutes`;
    } else {
      // DAG mode - estimate based on longest path
      return `${Math.ceil(stepCount / 2) * 2}-${Math.ceil(stepCount / 2) * 5} minutes`;
    }
  }

  function identifyRisks(workflow: WorkflowDefinition): string[] {
    const risks: string[] = [];

    // Check for missing approval steps
    const hasApproval = workflow.steps.some((s) => s.type === "approval");
    if (!hasApproval) {
      risks.push("No approval step - workflow will execute without human review");
    }

    // Check for circular dependencies in DAG mode
    if (workflow.mode === "dag") {
      const visited = new Set<string>();
      const recursionStack = new Set<string>();

      function hasCycle(stepId: string): boolean {
        visited.add(stepId);
        recursionStack.add(stepId);

        const step = workflow.steps.find((s) => s.id === stepId);
        if (step?.dependencies) {
          for (const depId of step.dependencies) {
            if (!visited.has(depId)) {
              if (hasCycle(depId)) return true;
            } else if (recursionStack.has(depId)) {
              return true;
            }
          }
        }

        recursionStack.delete(stepId);
        return false;
      }

      for (const step of workflow.steps) {
        if (!visited.has(step.id) && hasCycle(step.id)) {
          risks.push("Circular dependency detected in DAG - workflow may deadlock");
          break;
        }
      }
    }

    // Check for long execution chains
    if (workflow.mode === "serial" && workflow.steps.length > 10) {
      risks.push(
        `Long serial chain (${workflow.steps.length} steps) - consider parallelizing independent steps`
      );
    }

    return risks;
  }

  return {
    hera_create_workflow: tool({
      description: "Create a workflow definition with steps and execution mode",
      args: {
        name: z.string().describe("Workflow name"),
        description: z.string().describe("Workflow description"),
        mode: z
          .enum(["serial", "parallel", "dag"])
          .describe(
            "Execution mode: serial (sequential), parallel (concurrent), or dag (dependency graph)"
          ),
        steps: z
          .array(
            z.object({
              name: z.string().describe("Step name"),
              type: z.enum(["agent", "tool", "decision", "approval"]).describe("Step type"),
              executor: z
                .string()
                .optional()
                .describe("Agent name or tool name to execute this step"),
              dependencies: z
                .array(z.string())
                .optional()
                .describe("Step IDs that must complete before this step (for DAG mode)"),
              condition: z
                .string()
                .optional()
                .describe("Condition for conditional execution (e.g., 'coverage>80')"),
              timeout: z.number().optional().describe("Timeout in milliseconds"),
            })
          )
          .describe("Workflow steps"),
      },
      async execute(args) {
        const workflowId = randomUUID();
        const steps: WorkflowStep[] = args.steps.map((s, idx) => ({
          id: `step-${idx + 1}`,
          name: s.name,
          type: s.type,
          executor: s.executor,
          dependencies: s.dependencies,
          condition: s.condition,
          timeout: s.timeout,
        }));

        const workflow: WorkflowDefinition = {
          id: workflowId,
          name: args.name,
          description: args.description,
          mode: args.mode,
          steps,
          createdAt: Date.now(),
        };

        try {
          await ctx.workflowManager.createWorkflow(workflow);
        } catch (error) {
          return toolResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        return toolResult({
          success: true,
          workflowId,
          message: `Workflow '${args.name}' created with ${steps.length} steps in ${args.mode} mode`,
          workflow,
        });
      },
    }),

    hera_execute_workflow: tool({
      description:
        "Execute a workflow with given context. Optionally request user approval before execution.",
      args: {
        workflowId: z.string().describe("Workflow ID to execute"),
        context: z
          .record(z.string(), z.any())
          .optional()
          .describe("Initial context data for workflow execution"),
        requireApproval: z
          .boolean()
          .default(true)
          .describe("Whether to request user approval before execution"),
      },
      async execute(args) {
        const workflow = ctx.workflowManager.getWorkflow(args.workflowId);
        if (!workflow) {
          return toolResult({
            success: false,
            error: `Workflow not found: ${args.workflowId}`,
          });
        }

        // Generate execution plan
        const plan = {
          workflow: workflow.name,
          mode: workflow.mode,
          steps: workflow.steps.map(
            (s) => `${s.name} (${s.type}${s.executor ? `: ${s.executor}` : ""})`
          ),
          estimatedTime: estimateExecutionTime(workflow),
          risks: identifyRisks(workflow),
        };

        // If approval required, return plan for user review
        // Default to true if not specified
        const requireApproval = args.requireApproval !== false;
        if (requireApproval) {
          return toolResult({
            success: true,
            requiresApproval: true,
            plan,
            message:
              `Workflow execution plan ready. Please review and approve:\n\n` +
              `Workflow: ${plan.workflow}\n` +
              `Mode: ${plan.mode}\n` +
              `Steps:\n${plan.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\n` +
              `Estimated time: ${plan.estimatedTime}\n` +
              `${plan.risks.length > 0 ? `Risks:\n${plan.risks.map((r) => `  - ${r}`).join("\n")}` : "No significant risks identified"}\n\n` +
              `To proceed, call hera_approve_workflow with workflowId: ${args.workflowId}`,
          });
        }

        // Execute without approval
        try {
          const result = await ctx.workflowManager.executeWorkflow(
            args.workflowId,
            args.context || {}
          );

          return toolResult({
            success: true,
            result,
            message: `Workflow '${workflow.name}' completed successfully`,
          });
        } catch (error) {
          return toolResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }),

    hera_approve_workflow: tool({
      description: "Approve and execute a workflow that requires user approval",
      args: {
        workflowId: z.string().describe("Workflow ID to approve and execute"),
        context: z
          .record(z.string(), z.any())
          .optional()
          .describe("Initial context data for workflow execution"),
      },
      async execute(args) {
        const workflow = ctx.workflowManager.getWorkflow(args.workflowId);
        if (!workflow) {
          return toolResult({
            success: false,
            error: `Workflow not found: ${args.workflowId}`,
          });
        }

        try {
          const result = await ctx.workflowManager.executeWorkflow(
            args.workflowId,
            args.context || {}
          );

          return toolResult({
            success: true,
            result,
            message: `Workflow '${workflow.name}' approved and executed successfully`,
          });
        } catch (error) {
          return toolResult({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }),

    hera_get_workflow_status: tool({
      description: "Get execution status of a workflow",
      args: {
        executionId: z.string().describe("Execution ID to check status"),
      },
      async execute(args) {
        const execution = ctx.workflowManager.getExecutionStatus(args.executionId);
        if (!execution) {
          return toolResult({
            success: false,
            error: `Execution not found: ${args.executionId}`,
          });
        }

        const workflow = ctx.workflowManager.getWorkflow(execution.workflowId);
        const duration = execution.completedAt
          ? execution.completedAt - execution.startedAt
          : Date.now() - execution.startedAt;

        return toolResult({
          success: true,
          execution: {
            id: execution.id,
            workflow: workflow?.name || execution.workflowId,
            status: execution.status,
            currentStep: execution.currentStep,
            completedSteps: Object.keys(execution.stepResults).length,
            totalSteps: workflow?.steps.length || 0,
            duration: `${Math.round(duration / 1000)}s`,
            error: execution.error,
          },
        });
      },
    }),

    hera_list_workflows: tool({
      description: "List all available workflows",
      args: {},
      async execute() {
        const workflows = ctx.workflowManager.getAllWorkflows();
        return toolResult({
          success: true,
          count: workflows.length,
          workflows: workflows.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            mode: w.mode,
            steps: w.steps.length,
            createdAt: new Date(w.createdAt).toISOString(),
          })),
        });
      },
    }),

    hera_delete_workflow: tool({
      description: "Delete a workflow definition",
      args: {
        workflowId: z.string().describe("Workflow ID to delete"),
      },
      async execute(args) {
        const workflow = ctx.workflowManager.getWorkflow(args.workflowId);
        if (!workflow) {
          return toolResult({
            success: false,
            error: `Workflow not found: ${args.workflowId}`,
          });
        }

        const deleted = await ctx.workflowManager.deleteWorkflow(args.workflowId);
        return toolResult({
          success: deleted,
          message: deleted
            ? `Workflow '${workflow.name}' deleted successfully`
            : `Failed to delete workflow '${workflow.name}'`,
        });
      },
    }),
  };
}
