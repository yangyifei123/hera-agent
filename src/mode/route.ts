import type { ProgramRunner, ProgramResult, SessionCtx } from "../types.js";
import type { DriveModeStore } from "./store.js";
import type { StickyDriveMode } from "./types.js";
import { parseModeCommand, renderModeStatus } from "./command.js";
import { errorMessage } from "../helpers.js";

/**
 * A ProgramRunner used until Spec 2's real engine lands. Always reports the
 * engine is unavailable, so Spec 1 is independently testable and shippable.
 */
export class StubProgramRunner implements ProgramRunner {
  async run(_skillName: string, _args: unknown, _ctx: SessionCtx): Promise<ProgramResult> {
    return { ok: false, error: "program engine not yet available", logs: [] };
  }
}

export interface ModeRouteDeps {
  store: DriveModeStore;
  runner: ProgramRunner;
}

/**
 * Apply a `/mode` command for a session and return the user-facing reply text.
 * - no verb            -> status of the current sticky mode; no change.
 * - parse error        -> the error text; no change.
 * - auto / collab      -> set the sticky store; confirm.
 * - program <skill>    -> run the skill NOW via the runner; the sticky mode is
 *                         left untouched (program is an action, not a state).
 * Never throws: a runner rejection is caught and rendered as a failure.
 */
export async function handleModeCommand(
  args: string,
  ctx: SessionCtx,
  deps: ModeRouteDeps
): Promise<string> {
  const parsed = parseModeCommand(args);

  if (parsed.error) return parsed.error;
  if (!parsed.mode) return renderModeStatus(deps.store.get(ctx.sessionID));

  if (parsed.mode === "program") {
    const skill = parsed.skill as string; // parse guarantees a skill when mode === "program"
    let result: ProgramResult;
    try {
      result = await deps.runner.run(skill, {}, ctx);
    } catch (err) {
      result = { ok: false, error: errorMessage(err), logs: [] };
    }
    return renderProgramResult(skill, result);
  }

  const sticky = parsed.mode as StickyDriveMode; // "auto" | "collab"
  deps.store.set(ctx.sessionID, sticky);
  return `Drive mode set to ${sticky} for this session.`;
}

function renderProgramResult(skill: string, result: ProgramResult): string {
  const logs = result.logs.length > 0 ? `\n\nLogs:\n${result.logs.join("\n")}` : "";
  if (result.ok) {
    const value = typeof result.value === "string" ? result.value : JSON.stringify(result.value);
    return `Program "${skill}" completed. Result: ${value}${logs}`;
  }
  return `Program "${skill}" failed: ${result.error}${logs}`;
}
