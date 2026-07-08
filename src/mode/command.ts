import type { DriveMode } from "./types.js";

export interface ModeCommand {
  mode?: DriveMode;
  skill?: string;
  error?: string;
}

const VALID_HINT = "Valid: auto, collab, program <skill>.";

/**
 * Parse the raw argument string of a `/mode` command.
 * - "" (or whitespace) -> {} meaning "show status, change nothing".
 * - "auto" / "collab"  -> { mode }.
 * - "program <skill>"  -> { mode: "program", skill }.
 * - "program"          -> { error } (skill name required).
 * - anything else      -> { error } (unknown mode).
 */
export function parseModeCommand(args: string): ModeCommand {
  const trimmed = (args ?? "").trim();
  if (trimmed.length === 0) return {};

  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();

  if (verb === "auto" || verb === "collab") {
    return { mode: verb };
  }
  if (verb === "program") {
    const skill = parts[1];
    if (!skill) {
      return { error: "Usage: /mode program <skill> — a skill name is required." };
    }
    return { mode: "program", skill };
  }
  return { error: `Unknown mode "${verb}". ${VALID_HINT}` };
}

/** The `/mode` help/status text shown when no argument (or a bare status) is given. */
export function renderModeStatus(current: DriveMode): string {
  return [
    `Drive mode: ${current}`,
    "",
    "Usage:",
    "  /mode                    show this status",
    "  /mode auto               AI-led (background loop engine)",
    "  /mode collab             human <-> AI, turn by turn (default)",
    "  /mode program <skill>    run a program skill now (does not change the sticky mode)",
  ].join("\n");
}
