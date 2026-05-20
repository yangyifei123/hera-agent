/**
 * Structured error types for Hera Agent.
 * Provides consistent error handling across all modules.
 */

export enum ErrorCode {
  // Agent errors (1xxx)
  AGENT_NOT_FOUND = 1001,
  AGENT_ALREADY_EXISTS = 1002,
  AGENT_INVALID_NAME = 1003,
  AGENT_CREATION_FAILED = 1004,
  AGENT_DELETION_FAILED = 1005,
  AGENT_SPAWN_FAILED = 1006,

  // Skill errors (2xxx)
  SKILL_NOT_FOUND = 2001,
  SKILL_ALREADY_EXISTS = 2002,
  SKILL_INVALID_NAME = 2003,
  SKILL_CREATION_FAILED = 2004,
  SKILL_DELETION_FAILED = 2005,
  SKILL_BUILTIN_PROTECTED = 2006,

  // Team errors (3xxx)
  TEAM_NOT_FOUND = 3001,
  TEAM_ALREADY_EXISTS = 3002,
  TEAM_INVALID_NAME = 3003,
  TEAM_CREATION_FAILED = 3004,
  TEAM_SPAWN_FAILED = 3005,
  TEAM_MEMBER_NOT_FOUND = 3006,

  // Memory errors (4xxx)
  MEMORY_NOT_FOUND = 4001,
  MEMORY_SAVE_FAILED = 4002,
  MEMORY_LOAD_FAILED = 4003,
  MEMORY_INVALID_QUERY = 4004,

  // Evolution errors (5xxx)
  EVOLUTION_PROPOSAL_FAILED = 5001,
  EVOLUTION_APPLY_FAILED = 5002,
  EVOLUTION_ROLLBACK_FAILED = 5003,

  // Distillation errors (6xxx)
  DISTILLATION_FAILED = 6001,
  DISTILLATION_INVALID_SESSION = 6002,

  // File system errors (7xxx)
  FS_READ_FAILED = 7001,
  FS_WRITE_FAILED = 7002,
  FS_DELETE_FAILED = 7003,
  FS_PATH_INVALID = 7004,

  // Validation errors (8xxx)
  VALIDATION_FAILED = 8001,
  VALIDATION_INVALID_INPUT = 8002,

  // Plugin errors (9xxx)
  PLUGIN_GENERATION_FAILED = 9001,
  PLUGIN_INSTALL_FAILED = 9002,
  PLUGIN_BUILD_FAILED = 9003,
}

export class HeraError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HeraError";
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class AgentError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "AgentError";
  }
}

export class SkillError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "SkillError";
  }
}

export class TeamError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "TeamError";
  }
}

export class MemoryError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "MemoryError";
  }
}

export class EvolutionError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "EvolutionError";
  }
}

export class DistillationError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "DistillationError";
  }
}

export class FileSystemError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "FileSystemError";
  }
}

export class ValidationError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "ValidationError";
  }
}

export class PluginError extends HeraError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "PluginError";
  }
}

/**
 * Helper to check if an error is a Hera error
 */
export function isHeraError(error: unknown): error is HeraError {
  return error instanceof HeraError;
}

/**
 * Helper to wrap unknown errors as HeraError
 */
export function wrapError(error: unknown, code: ErrorCode, context?: string): HeraError {
  if (isHeraError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const fullMessage = context ? `${context}: ${message}` : message;

  return new HeraError(code, fullMessage, {
    originalError: error instanceof Error ? error.stack : String(error),
  });
}

/**
 * Helper to create user-friendly error messages
 */
export function formatErrorMessage(error: HeraError): string {
  const parts = [`[${error.name}] ${error.message}`];

  if (error.details) {
    const detailStr = Object.entries(error.details)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(", ");
    parts.push(`Details: ${detailStr}`);
  }

  return parts.join("\n");
}
