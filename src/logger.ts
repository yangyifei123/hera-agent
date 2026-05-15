/**
 * Hera Logging Utility
 *
 * Provides structured logging with configurable log levels via HERA_LOG_LEVEL env var.
 * Levels: debug < info < warn (default: warn)
 */

export type LogLevel = "debug" | "info" | "warn";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
};

let cachedLevel: LogLevel | null = null;

function getLogLevel(): LogLevel {
  if (cachedLevel !== null) return cachedLevel;
  const env = process.env.HERA_LOG_LEVEL?.toLowerCase();
  if (env === "debug") cachedLevel = "debug";
  else if (env === "info") cachedLevel = "info";
  else cachedLevel = "warn";
  return cachedLevel;
}

/**
 * Reset cached log level (for testing purposes)
 */
export function resetLogLevel(): void {
  cachedLevel = null;
}

/**
 * Set log level directly (for testing purposes)
 */
export function setLogLevel(level: LogLevel): void {
  cachedLevel = level;
}

/**
 * Log a message at the specified level.
 *
 * - debug: only when HERA_LOG_LEVEL=debug
 * - info: when HERA_LOG_LEVEL=info or debug
 * - warn: always
 *
 * @param level - Log level
 * @param message - Log message
 * @param data - Optional extra data to include in output
 */
export function heraLog(level: LogLevel, message: string, data?: unknown): void {
  const currentLevel = getLogLevel();
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const prefix = `[Hera] [${level.toUpperCase()}]`;

  if (data !== undefined) {
    console.error(`${prefix} ${message}`, data);
  } else {
    console.error(`${prefix} ${message}`);
  }
}
