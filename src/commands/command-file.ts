/**
 * OpenCode native command files (`<configRoot>/command/<name>.md`).
 *
 * A command file makes a `/keyword` appear in OpenCode's native `/` autocomplete.
 * Its front-matter `agent:` routes the command to an agent; the body is the
 * template expanded into the prompt (with `$ARGUMENTS` substituted). This is the
 * mechanism omo-style plugins use to ship keyword-triggered agents (e.g.
 * `/socrates …`), and the same mechanism Hera's own `/mode` command uses
 * ([[src/mode/install.ts]]).
 */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWriteText } from "../helpers.js";

/** Placeholder OpenCode substitutes with the text the user typed after the command. */
export const ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";

export interface CommandSpec {
  /** The `/keyword` — also the filename (`<name>.md`). Must be a safe segment. */
  name: string;
  /** Agent the command routes to (front-matter `agent:`). */
  agent: string;
  /** One-line description shown in OpenCode's command list. */
  description: string;
  /**
   * Template body. Defaults to `$ARGUMENTS`, which forwards the user's text to
   * the agent verbatim. Pass a custom body for commands that do their real work
   * elsewhere (e.g. a plugin hook) and only need a status echo.
   */
  body?: string;
}

/** Windows reserved device names — a file named `con.md`, `nul.md`, etc. cannot be created. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A command name must be a single safe filename segment: start with a lowercase
 * letter, contain only lowercase letters/digits/hyphens, no trailing hyphen,
 * max 50 chars, and not be a Windows reserved device name. This blocks
 * path-traversal (`../x`) before the name is joined with the command directory.
 * (No reserved-agent-name check — unlike agents, a command may legitimately be
 * named e.g. `system`.)
 */
export function validateCommandName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { valid: false, error: "Command name is required." };
  }
  if (name.length > 50) {
    return { valid: false, error: "Command name must be 50 characters or less." };
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name.endsWith("-")) {
    return {
      valid: false,
      error:
        "Command name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.",
    };
  }
  if (WINDOWS_RESERVED.test(name)) {
    return {
      valid: false,
      error: `"${name}" is a reserved device name and cannot be used as a command.`,
    };
  }
  return { valid: true };
}

/**
 * Collapse a description to one YAML-front-matter-safe line: no newlines (which
 * would break out of the front-matter block), no quotes/colons (which could
 * inject or confuse YAML), capped at 120 chars. Empty input falls back to a
 * safe default. This is the single source of truth shared by the live
 * `hera_create_command` path and the plugin-export path.
 */
export function sanitizeCommandDescription(s: string): string {
  const clean = (s || "").replace(/\s+/g, " ").replace(/["':]/g, "").trim().slice(0, 120);
  return clean || "OpenCode agent";
}

/**
 * Reduce an agent reference to a single front-matter-safe token: only the
 * characters legal in an agent name survive, so a newline or `:` in the input
 * cannot inject additional YAML keys or break out of the `agent:` line.
 */
export function sanitizeAgentRef(agent: string): string {
  return (agent || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
}

/**
 * Render the markdown for a command file that routes `/name` to `agent`. The
 * front-matter fields are sanitized so untrusted `description`/`agent` values
 * (e.g. containing a newline + `---`) cannot inject front-matter keys or break
 * out into an attacker-controlled command body. The body is intentionally left
 * verbatim — it is the command's own template.
 */
export function buildCommandMarkdown(spec: CommandSpec): string {
  const body = spec.body ?? ARGUMENTS_PLACEHOLDER;
  return [
    "---",
    `description: ${sanitizeCommandDescription(spec.description)}`,
    `agent: ${sanitizeAgentRef(spec.agent)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Write a command file to `<configRoot>/command/<name>.md` atomically. Throws on
 * an invalid name or a write failure — the caller decides best-effort (swallow)
 * vs. surfaced error. Returns the written path.
 */
export async function writeCommandFile(
  configRoot: string,
  name: string,
  markdown: string
): Promise<string> {
  const check = validateCommandName(name);
  if (!check.valid) throw new Error(check.error);
  const dir = join(configRoot, "command");
  const filePath = join(dir, `${name}.md`);
  await mkdir(dir, { recursive: true });
  await atomicWriteText(filePath, markdown);
  return filePath;
}
