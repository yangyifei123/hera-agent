/**
 * Semi-Automatic Evolution
 * Proposes evolution directives based on detected failure patterns.
 * Never auto-applies — always requires explicit hera_evolve_agent call.
 */

import type { EvolutionEntry } from "../types.js";

/** Maximum length for the trigger field extracted from failure context */
const TRIGGER_MAX_LENGTH = 100;

const FAILURE_PATTERNS: Array<{ pattern: RegExp; directive: string }> = [
  {
    pattern: /SQL injection|injection|parameterized/i,
    directive: "Always verify database queries use parameterized statements or prepared statements.",
  },
  {
    pattern: /null pointer|null reference|cannot read prop|undefined/i,
    directive: "Always check for null/undefined before accessing object properties. Use optional chaining (?.) where appropriate.",
  },
  {
    pattern: /race condition|async|await|concurrent/i,
    directive: "Always handle async operations with proper await or Promise chaining. Use locks or atomic operations for shared state.",
  },
  {
    pattern: /memory leak|leak|not cleaned up/i,
    directive: "Always clean up resources (event listeners, timers, subscriptions) when components are destroyed.",
  },
  {
    pattern: /XSS|cross.site|sanitize|escape/i,
    directive: "Always sanitize user input before rendering in HTML. Use a trusted sanitization library.",
  },
  {
    pattern: /timeout|slow|performance|optimize/i,
    directive: "Always profile before optimizing. Focus on algorithmic complexity and I/O bottlenecks first.",
  },
  {
    pattern: /test fail|assertion|coverage/i,
    directive: "Always write tests for new features and bug fixes. Aim for >80% line coverage.",
  },
];

/**
 * Analyze a failure context string and propose an evolution directive if a
 * known pattern is matched. Returns null if no pattern matches.
 *
 * This is a pure function — it never mutates agent state.
 * The caller must explicitly use hera_evolve_agent to apply the proposal.
 */
export function proposeEvolution(failureContext: string): EvolutionEntry | null {
  if (!failureContext) return null;

  for (const { pattern, directive } of FAILURE_PATTERNS) {
    if (pattern.test(failureContext)) {
      return {
        timestamp: Date.now(),
        trigger: failureContext.slice(0, TRIGGER_MAX_LENGTH),
        observation: "Auto-detected failure pattern",
        directive,
        rolledBack: false,
      };
    }
  }

  return null;
}
