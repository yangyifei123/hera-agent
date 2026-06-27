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
 * Validates a skill name before it is used as a filesystem path segment.
 * Mirrors agent-name rules so a skill named "../../agents/hera" (a recursive
 * force-delete primitive) or "../../../x" (a write/read escape) is rejected
 * before any join() with the skills directory.
 *
 * @param name - Skill name to validate
 */
export function validateSkillName(name: string): ValidationResult {
  if (!name || name.length === 0) {
    return { valid: false, error: "Skill name is required." };
  }
  if (name.length > 64) {
    return {
      valid: false,
      error: "Skill name must be 64 characters or less.",
      suggestion: name.slice(0, 64),
    };
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name.endsWith("-")) {
    const suggestion = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return {
      valid: false,
      error:
        "Skill name must start with a letter and contain only lowercase letters, numbers, and hyphens.",
      suggestion: /^[a-z]/.test(suggestion) ? suggestion : `skill-${suggestion}`,
    };
  }
  return { valid: true };
}

/**
 * Rejects a relative file path that would escape its intended base directory
 * (zip-slip / path traversal). Returns true when `relPath` is safe to join.
 *
 * @param relPath - The package-supplied relative path to vet
 */
export function isSafeRelativePath(relPath: string): boolean {
  if (typeof relPath !== "string" || relPath.length === 0) return false;
  // Reject absolute paths, drive letters, NUL, and any `..` segment.
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(relPath)) return false;
  if (relPath.includes("\0")) return false;
  const segments = relPath.split(/[\\/]+/);
  return !segments.some((seg) => seg === "..");
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
