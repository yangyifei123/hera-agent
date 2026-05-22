import type { AgentDefinition, TeamDefinition, WorkflowDefinition } from "../types.js";
import { WORKFLOW_TEMPLATES, AGENT_TEMPLATE_TO_WORKFLOW } from "./templates.js";

export class WorkflowAutoAssigner {
  /**
   * Assign a workflow to an agent based on its template
   */
  assignWorkflowToAgent(agentDef: AgentDefinition): WorkflowDefinition | undefined {
    if (!agentDef.template) {
      return WORKFLOW_TEMPLATES["general-workflow"];
    }

    const workflowId = AGENT_TEMPLATE_TO_WORKFLOW[agentDef.template];
    return workflowId ? WORKFLOW_TEMPLATES[workflowId] : undefined;
  }

  /**
   * Design a custom workflow for an agent based on requirements
   * This would typically use brainstorming to analyze the agent's purpose
   */
  designWorkflowForAgent(agentDef: AgentDefinition, _requirements?: string): WorkflowDefinition {
    // For now, fall back to template-based assignment
    // In a full implementation, this would:
    // 1. Analyze agent's purpose and skills
    // 2. Use brainstorming to generate workflow approaches
    // 3. Select best workflow structure
    // 4. Return customized workflow

    const templateWorkflow = this.assignWorkflowToAgent(agentDef);
    if (templateWorkflow) {
      return {
        ...templateWorkflow,
        id: `${agentDef.name}-workflow`,
        name: `${agentDef.name} Workflow`,
        description: `Custom workflow for ${agentDef.name}: ${agentDef.description}`,
        metadata: {
          ...templateWorkflow.metadata,
          agentName: agentDef.name,
          customized: true,
        },
      };
    }

    // Fallback to general workflow
    return {
      ...WORKFLOW_TEMPLATES["general-workflow"],
      id: `${agentDef.name}-workflow`,
      name: `${agentDef.name} Workflow`,
      description: `Workflow for ${agentDef.name}`,
      metadata: {
        agentName: agentDef.name,
        customized: true,
      },
    };
  }

  /**
   * Design a workflow for a team based on its structure
   */
  designWorkflowForTeam(teamDef: TeamDefinition): WorkflowDefinition {
    const { coordination, management, members } = teamDef;

    // Base workflow on coordination mode
    let baseWorkflow: WorkflowDefinition;

    if (coordination === "parallel") {
      // All members work concurrently
      baseWorkflow = {
        id: `${teamDef.name}-workflow`,
        name: `${teamDef.name} Team Workflow`,
        description: `Parallel workflow for ${teamDef.name}`,
        mode: "parallel",
        steps: members.map((member, idx) => ({
          id: `step-${idx + 1}`,
          name: `${member.role} Task`,
          type: "agent" as const,
          executor: member.agentName,
        })),
        createdAt: Date.now(),
        metadata: {
          teamName: teamDef.name,
          coordination,
          management,
        },
      };
    } else if (coordination === "sequential") {
      // Members work in sequence
      baseWorkflow = {
        id: `${teamDef.name}-workflow`,
        name: `${teamDef.name} Team Workflow`,
        description: `Sequential workflow for ${teamDef.name}`,
        mode: "serial",
        steps: members.map((member, idx) => ({
          id: `step-${idx + 1}`,
          name: `${member.role} Task`,
          type: "agent" as const,
          executor: member.agentName,
          dependencies: idx > 0 ? [`step-${idx}`] : undefined,
        })),
        createdAt: Date.now(),
        metadata: {
          teamName: teamDef.name,
          coordination,
          management,
        },
      };
    } else {
      // Adaptive: planner first, then parallel execution
      const plannerStep = {
        id: "step-1",
        name: "Planning",
        type: "agent" as const,
        executor: members[0]?.agentName || "coordinator",
      };

      const executionSteps = members.slice(1).map((member, idx) => ({
        id: `step-${idx + 2}`,
        name: `${member.role} Task`,
        type: "agent" as const,
        executor: member.agentName,
        dependencies: ["step-1"],
      }));

      baseWorkflow = {
        id: `${teamDef.name}-workflow`,
        name: `${teamDef.name} Team Workflow`,
        description: `Adaptive workflow for ${teamDef.name}`,
        mode: "dag",
        steps: [plannerStep, ...executionSteps],
        createdAt: Date.now(),
        metadata: {
          teamName: teamDef.name,
          coordination,
          management,
        },
      };
    }

    // Add management-specific steps
    if (management === "okr" && teamDef.objectives) {
      // Add progress tracking steps
      baseWorkflow.steps.push({
        id: `step-${baseWorkflow.steps.length + 1}`,
        name: "Update OKR Progress",
        type: "tool",
        executor: "okr_tracker",
        dependencies: baseWorkflow.steps.map((s) => s.id),
      });
    } else if (management === "control" && teamDef.controlPoints) {
      // Add control point gates
      const approvalStep = {
        id: `step-${baseWorkflow.steps.length + 1}`,
        name: "Control Point Approval",
        type: "approval" as const,
        dependencies: baseWorkflow.steps.map((s) => s.id),
      };
      baseWorkflow.steps.push(approvalStep);
    }

    return baseWorkflow;
  }

  /**
   * Get all available workflow templates
   */
  getAvailableTemplates(): WorkflowDefinition[] {
    return Object.values(WORKFLOW_TEMPLATES);
  }

  /**
   * Get workflow template by ID
   */
  getTemplate(id: string): WorkflowDefinition | undefined {
    return WORKFLOW_TEMPLATES[id];
  }
}
