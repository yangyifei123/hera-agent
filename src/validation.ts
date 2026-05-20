/**
 * Hera Validation Utilities
 * Agent name validation with helpful suggestions
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/** Reserved agent names that cannot be used */
const RESERVED_NAMES = ["hera", "opencode", "system"];

/**
 * Validates an agent name according to Hera naming rules:
 * - Required (non-empty)
 * - Max 50 characters
 * - Must start with lowercase letter
 * - Only lowercase letters, numbers, and hyphens
 * - Cannot be a reserved name
 *
 * @param name - Agent name to validate
 * @returns ValidationResult with valid status, error message, and optional suggestion
 */
export function validateAgentName(name: string): ValidationResult {
  if (!name || name.length === 0) {
    return { valid: false, error: "Agent name is required." };
  }

  if (name.length > 50) {
    return {
      valid: false,
      error: "Agent name must be 50 characters or less.",
      suggestion: name.slice(0, 50),
    };
  }

  // Must start with letter, contain only lowercase letters, numbers, hyphens
  // Cannot end with hyphen
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name.endsWith("-")) {
    // Generate suggestion: lowercase, replace invalid chars with hyphens, trim edges, ensure starts with letter
    let suggestion = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    // If starts with digit, prepend 'a'
    if (/^\d/.test(suggestion)) {
      suggestion = "a" + suggestion;
    }

    // Ensure starts with letter after all transformations
    if (!/^[a-z]/.test(suggestion)) {
      suggestion = "agent-" + suggestion;
    }

    return {
      valid: false,
      error:
        "Agent name must start with a letter and contain only lowercase letters, numbers, and hyphens.",
      suggestion,
    };
  }

  if (RESERVED_NAMES.includes(name)) {
    return {
      valid: false,
      error: `"${name}" is a reserved name. Choose a different name.`,
    };
  }

  return { valid: true };
}

/**
 * Validates agent name and checks for conflicts with existing agents.
 *
 * @param name - Agent name to validate
 * @param existingNames - Set/map of existing agent names
 * @returns ValidationResult with additional conflict info if applicable
 */
export function validateAgentNameWithConflict(
  name: string,
  existingNames: Set<string> | Map<string, unknown>
): ValidationResult {
  // First run basic validation
  const baseResult = validateAgentName(name);
  if (!baseResult.valid) return baseResult;

  // Check for conflicts
  const nameSet = existingNames instanceof Map ? existingNames.keys() : existingNames.values();

  const hasExisting = Array.from(nameSet).includes(name);
  if (hasExisting) {
    return {
      valid: false,
      error: `Agent "${name}" already exists. Use hera_delete_agent to remove it first.`,
    };
  }

  return { valid: true };
}
