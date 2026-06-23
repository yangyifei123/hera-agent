import { join } from "node:path";

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

/** Maximum retained in-memory inbox messages per team. */
export const TEAM_MESSAGE_QUEUE_CAP = 100;

/** Maximum age for team inbox messages before pruning (7 days). */
export const TEAM_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum concurrent workflow executions in one plugin process. */
export const MAX_CONCURRENT_WORKFLOWS = 20;

// === Memory Configuration ===

/** Default memory limit for stored entries */
export const DEFAULT_MEMORY_LIMIT = 1000;

// === Default Skills ===

/** Default skills inherited by all agents */
export const DEFAULT_SKILLS = [
  "caveman",
  "init",
  "memory",
  "evolution",
  "skill-combo",
  "subagent",
  "communicate",
  "auto-compact",
  "workflow-orchestration",
  "brainstorming",
  "skill-creator",
] as const;

// === Runtime Paths ===

export type ConfigRootPlatform = NodeJS.Platform;

export type ConfigRootEnv =
  | NodeJS.ProcessEnv
  | {
      USERPROFILE?: string;
      HOME?: string;
      HERA_CONFIG_ROOT?: string;
      OPENCODE_CONFIG_ROOT?: string;
    };

/**
 * Resolve the OpenCode config root used by Hera's plugin runtime and CLI helpers.
 *
 * Precedence (highest first):
 *   1. `HERA_CONFIG_ROOT` — canonical override for the Hera/OpenCode config root.
 *   2. `OPENCODE_CONFIG_ROOT` — legacy alias kept for backward compatibility.
 *   3. Platform default under the user's home (`.config/opencode`).
 *
 * New code and docs should prefer `HERA_CONFIG_ROOT`; the alias is read-only
 * compatibility for existing setups and is never written by Hera.
 */
export function resolveOpenCodeConfigRoot(
  env: ConfigRootEnv = process.env,
  platform: ConfigRootPlatform = process.platform
): string {
  if (env.HERA_CONFIG_ROOT) {
    return env.HERA_CONFIG_ROOT;
  }
  if (env.OPENCODE_CONFIG_ROOT) {
    return env.OPENCODE_CONFIG_ROOT;
  }
  if (platform === "win32") {
    const home = env.USERPROFILE ?? env.HOME ?? "C:/Users/Administrator";
    return join(home, ".config", "opencode");
  }
  const home = env.HOME ?? "/root";
  return join(home, ".config", "opencode");
}

/** Canonical OpenCode config root for the current process. */
export function getConfigRoot(): string {
  return resolveOpenCodeConfigRoot();
}

// === Team Management UX ===

export type TeamManagementMode = "simple" | "okr" | "tree" | "control";

export const TEAM_MANAGEMENT_DESCRIPTIONS: Record<TeamManagementMode, string> = {
  simple: "flat team with no extra tracking; coordinate freely with peers",
  okr: "objectives and key results for progress tracking; use objectives to report outcomes",
  tree: "hierarchical delegation view; root member delegates and workers report upward",
  control: "approval checkpoints and gates for review-heavy work",
};

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

// === Task Engine Configuration ===

/** Default number of tasks the supervisor runs concurrently. */
export const TASK_CONCURRENCY = 8;

/** Default retry budget per task before it is marked failed. */
export const TASK_DEFAULT_MAX_ATTEMPTS = 3;

/** Default base backoff (ms) between task attempts. */
export const TASK_DEFAULT_BACKOFF_MS = 1000;

/** Default task lease duration (ms); expiry drives crash recovery. */
export const TASK_LEASE_MS = 300000;

/** Supervisor dispatch tick interval (ms). */
export const SUPERVISOR_TICK_MS = 500;
