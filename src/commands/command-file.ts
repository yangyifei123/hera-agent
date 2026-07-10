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

/**
 * A command name must be a single safe filename segment: start with a lowercase
 * letter, contain only lowercase letters/digits/hyphens, no trailing hyphen,
 * max 50 chars. This blocks path-traversal (`../x`) before the name is joined
 * with the command directory. (No reserved-name check — unlike agents, a command
 * may legitimately be named e.g. `system`.)
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
  return { valid: true };
}

/** Render the markdown for a command file that routes `/name` to `agent`. */
export function buildCommandMarkdown(spec: CommandSpec): string {
  const body = spec.body ?? ARGUMENTS_PLACEHOLDER;
  return [
    "---",
    `description: ${spec.description}`,
    `agent: ${spec.agent}`,
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
