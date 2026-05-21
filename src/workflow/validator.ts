/**
 * Workflow Validation
 *
 * Validates workflow definitions for correctness, including:
 * - Step ID uniqueness
 * - Dependency validity
 * - Circular dependency detection
 * - Mode-specific requirements
 */

import type { WorkflowDefinition, WorkflowStep } from "../types.js";
import { CircularDependencyError, WorkflowValidationError } from "../errors.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class WorkflowValidator {
  /**
   * Validate a workflow definition
   */
  static validate(def: WorkflowDefinition): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!def.id || def.id.trim() === '') {
      errors.push('Workflow ID is required');
    }

    if (!def.name || def.name.trim() === '') {
      errors.push('Workflow name is required');
    }

    if (!def.steps || def.steps.length === 0) {
      errors.push('Workflow must have at least one step');
    }

    if (def.steps) {
      // Step ID uniqueness
      const stepIds = new Set<string>();
      for (const step of def.steps) {
        if (!step.id || step.id.trim() === '') {
          errors.push('All steps must have an ID');
          continue;
        }

        if (stepIds.has(step.id)) {
          errors.push(`Duplicate step ID: ${step.id}`);
        }
        stepIds.add(step.id);

        // Step name validation
        if (!step.name || step.name.trim() === '') {
          warnings.push(`Step ${step.id} has no name`);
        }

        // Executor validation
        if (step.type === 'agent' && !step.executor) {
          warnings.push(`Agent step ${step.id} has no executor specified`);
        }
      }

      // Dependency validation
      for (const step of def.steps) {
        if (step.dependencies) {
          for (const depId of step.dependencies) {
            if (!stepIds.has(depId)) {
              errors.push(`Step ${step.id} depends on non-existent step: ${depId}`);
            }
            if (depId === step.id) {
              errors.push(`Step ${step.id} cannot depend on itself`);
            }
          }
        }
      }

      // Circular dependency detection
      if (errors.length === 0) {
        const cycles = this.detectCycles(def.steps);
        if (cycles.length > 0) {
          for (const cycle of cycles) {
            errors.push(`Circular dependency detected: ${cycle}`);
          }
        }
      }

      // Mode-specific validation
      if (def.mode === 'dag') {
        const hasDeps = def.steps.some(s => s.dependencies && s.dependencies.length > 0);
        if (!hasDeps) {
          warnings.push('DAG mode workflow has no dependencies - consider using parallel mode');
        }
      }

      if (def.mode === 'serial' && def.steps.length === 1) {
        warnings.push('Serial workflow with single step - consider simplifying');
      }

      // Timeout validation
      for (const step of def.steps) {
        if (step.timeout !== undefined && step.timeout <= 0) {
          errors.push(`Step ${step.id} has invalid timeout: ${step.timeout}`);
        }
      }

      // Retry policy validation
      for (const step of def.steps) {
        if (step.retryPolicy) {
          if (step.retryPolicy.maxAttempts < 0) {
            errors.push(`Step ${step.id} has invalid retry maxAttempts: ${step.retryPolicy.maxAttempts}`);
          }
          if (step.retryPolicy.backoffMs < 0) {
            errors.push(`Step ${step.id} has invalid retry backoffMs: ${step.retryPolicy.backoffMs}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate and throw if invalid
   */
  static validateOrThrow(def: WorkflowDefinition): void {
    const result = this.validate(def);
    if (!result.valid) {
      throw new WorkflowValidationError(def.id, result.errors);
    }
  }

  /**
   * Detect circular dependencies using DFS
   */
  private static detectCycles(steps: WorkflowStep[]): string[] {
    const graph = new Map<string, string[]>();
    steps.forEach(s => graph.set(s.id, s.dependencies || []));

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (node: string, path: string[]): boolean => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const deps = graph.get(node) || [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep, [...path])) {
            return true;
          }
        } else if (recStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          const cycle = [...path.slice(cycleStart), dep];
          cycles.push(cycle.join(' → '));
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        dfs(step.id, []);
      }
    }

    return cycles;
  }

  /**
   * Check if a workflow has any approval steps
   */
  static hasApprovalSteps(def: WorkflowDefinition): boolean {
    return def.steps.some(s => s.type === 'approval');
  }

  /**
   * Get all leaf steps (steps with no dependents)
   */
  static getLeafSteps(def: WorkflowDefinition): WorkflowStep[] {
    const dependents = new Set<string>();
    for (const step of def.steps) {
      if (step.dependencies) {
        step.dependencies.forEach(dep => dependents.add(dep));
      }
    }

    return def.steps.filter(s => !dependents.has(s.id));
  }

  /**
   * Get all root steps (steps with no dependencies)
   */
  static getRootSteps(def: WorkflowDefinition): WorkflowStep[] {
    return def.steps.filter(s => !s.dependencies || s.dependencies.length === 0);
  }

  /**
   * Estimate workflow complexity (0-100)
   */
  static estimateComplexity(def: WorkflowDefinition): number {
    let score = 0;

    // Base score from step count
    score += Math.min(def.steps.length * 5, 30);

    // Dependency complexity
    const totalDeps = def.steps.reduce((sum, s) => sum + (s.dependencies?.length || 0), 0);
    score += Math.min(totalDeps * 3, 20);

    // Mode complexity
    if (def.mode === 'dag') score += 20;
    else if (def.mode === 'parallel') score += 10;
    else score += 5;

    // Approval steps add complexity
    const approvalCount = def.steps.filter(s => s.type === 'approval').length;
    score += approvalCount * 5;

    // Conditional steps add complexity
    const conditionalCount = def.steps.filter(s => s.condition).length;
    score += conditionalCount * 3;

    // Retry policies add complexity
    const retryCount = def.steps.filter(s => s.retryPolicy).length;
    score += retryCount * 2;

    return Math.min(score, 100);
  }
}
