/**
 * Hera Constants - Centralized configuration values
 * All magic numbers extracted to this file for maintainability
 */

// === Agent Configuration ===

/** Default max steps for Hera primary agent */
export const DEFAULT_HERA_MAX_STEPS = 50;

/** Default max steps for child/sub agents */
export const DEFAULT_CHILD_MAX_STEPS = 30;

// === Team Configuration ===

/** Maximum attempts to poll for session completion */
export const TEAM_POLL_MAX_ATTEMPTS = 120;

/** Interval in milliseconds between poll attempts */
export const TEAM_POLL_INTERVAL_MS = 1000;

/** Default team task timeout in milliseconds (5 minutes) */
export const DEFAULT_TEAM_TIMEOUT_MS = 300000;

// === Memory Configuration ===

/** Default memory limit for stored entries */
export const DEFAULT_MEMORY_LIMIT = 1000;

// === Default Skills ===

/** Default skills inherited by all agents */
export const DEFAULT_SKILLS = ["caveman", "init", "memory", "evolution"] as const;

// === Default Permissions ===

/** Default agent permissions */
export const DEFAULT_PERMISSION = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
} as const;

// === Distillation Limits ===

/** Maximum number of decisions to extract from session */
export const MAX_DISTILL_DECISIONS = 10;

/** Maximum number of patterns to extract from session */
export const MAX_DISTILL_PATTERNS = 20;

/** Maximum length for summary text */
export const MAX_SUMMARY_LENGTH = 200;

/** Maximum length for skill description */
export const MAX_SKILL_DESC_LENGTH = 100;

// === Recall/Search Limits ===

/** Maximum number of recall results to return */
export const MAX_RECALL_RESULTS = 10;

/** Maximum length for result preview in output */
export const MAX_RESULT_PREVIEW_LENGTH = 200;
