import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWriteText, errorMessage } from "../helpers.js";
import { heraLog } from "../logger.js";

/**
 * Markdown body for the native `/mode` command file. Front-matter routes the
 * command to the `hera` agent; `$ARGUMENTS` is OpenCode's command-template
 * placeholder. `command.execute.before` already performs the `/mode` action
 * (setting the sticky mode, or running a program skill) and pushes its own
 * reply part before the model ever sees this body, so the body itself must be
 * a pure status echo: it must NOT instruct the model to (re-)invoke anything,
 * because `program <skill>` is side-effecting and a model-initiated re-run
 * would execute the skill a second time.
 */
export const MODE_COMMAND_MARKDOWN = [
  "---",
  "description: Switch Hera's drive mode (auto | collab | program <skill>)",
  "agent: hera",
  "---",
  "",
  "Hera's `command.execute.before` hook has ALREADY handled `/mode $ARGUMENTS`",
  "natively: it set the session drive mode (auto/collab), or ran the requested",
  "program skill (program <skill>), and its status-line reply is already",
  "attached to this response.",
  "",
  "Do not call any tool. In particular, do NOT call `hera_run_program`, and do",
  "NOT re-run the mode change or the program skill in any other way — the",
  "action has already happened. Simply acknowledge the result shown above.",
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
