import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWriteText, errorMessage } from "../helpers.js";
import { heraLog } from "../logger.js";

/**
 * Markdown body for the native `/mode` command file. Front-matter routes the
 * command to the `hera` agent; `$ARGUMENTS` is OpenCode's command-template
 * placeholder. The real logic lives in Hera's command.execute.before hook —
 * this template is only the discoverability/fallback surface.
 */
export const MODE_COMMAND_MARKDOWN = [
  "---",
  "description: Switch Hera's drive mode (auto | collab | program <skill>)",
  "agent: hera",
  "---",
  "",
  "The user invoked `/mode $ARGUMENTS`.",
  "",
  "Hera handles this natively via its command.execute.before hook: it sets the",
  "session drive mode (auto/collab) or runs a program skill (program <skill>) and",
  "replies with a status line. If you are reading this as a fallback, restate the",
  "current drive mode and the usage: `/mode auto`, `/mode collab`,",
  "`/mode program <skill>`.",
  "",
].join("\n");

/**
 * Write the `/mode` command file so it appears in OpenCode's native `/`
 * autocomplete. Idempotent (always overwrites with the same content), like
 * ensureHeraMd. Best-effort: a write failure is logged at warn and swallowed,
 * because the chat.message fallback still makes `/mode` work without the file.
 */
export async function writeModeCommandFile(configRoot: string): Promise<void> {
  const dir = join(configRoot, "command");
  const filePath = join(dir, "mode.md");
  try {
    await mkdir(dir, { recursive: true });
    await atomicWriteText(filePath, MODE_COMMAND_MARKDOWN);
  } catch (err) {
    heraLog("warn", `Could not write ${filePath}: ${errorMessage(err)}`);
  }
}
