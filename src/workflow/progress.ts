/**
 * Workflow Progress Callback Interface
 *
 * Provides hooks for monitoring workflow execution progress
 */

import type { WorkflowStep } from "../types.js";

export interface WorkflowStepResult {
  status: 'success' | 'failure' | 'skipped';
  output?: unknown;
  error?: string;
  duration: number;
  timestamp: number;
  retryCount?: number;
}

export interface WorkflowProgressCallback {
  onStepStart?: (stepId: string, stepName: string, step: WorkflowStep) => void;
  onStepComplete?: (stepId: string, result: WorkflowStepResult) => void;
  onStepError?: (stepId: string, error: Error, willRetry: boolean) => void;
  onWorkflowProgress?: (completed: number, total: number, percentage: number) => void;
  onWorkflowPaused?: (executionId: string, reason: string) => void;
  onWorkflowResumed?: (executionId: string) => void;
}

/**
 * Concurrency Limiter
 *
 * Limits the number of concurrent operations to prevent resource exhaustion
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    if (maxConcurrent <= 0) {
      throw new Error('maxConcurrent must be positive');
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}
