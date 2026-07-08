import { randomUUID } from "node:crypto";
import type { Part } from "@opencode-ai/sdk";
import type { SessionCtx } from "../types.js";
import type { ModeRouteDeps } from "./route.js";
import { handleModeCommand } from "./route.js";

/**
 * Best-effort de-dupe so a `/mode` handled by command.execute.before is not
 * re-applied by the chat.message fallback. command.execute.before marks the
 * session; the fallback consults (and clears) the mark. Ordering caveat: if the
 * runtime were to fire chat.message strictly before command.execute.before, the
 * mark is absent and the fallback handles it (still correct, just via the other
 * path — sticky sets are idempotent).
 */
export class ModeDispatchGuard {
  private handled = new Set<string>();

  markHandled(sessionID: string): void {
    this.handled.add(sessionID);
  }

  /** Returns true (and clears the mark) if this session was just handled by a command. */
  consume(sessionID: string): boolean {
    if (!this.handled.has(sessionID)) return false;
    this.handled.delete(sessionID);
    return true;
  }
}

/**
 * Build a synthetic text Part for a hook's output.parts. id is generated;
 * messageID is left blank (OpenCode assigns real ids); marked synthetic because
 * Hera injected it rather than the model.
 */
export function makeModeTextPart(sessionID: string, text: string): Part {
  return {
    id: randomUUID(),
    sessionID,
    messageID: "",
    type: "text",
    text,
    synthetic: true,
  };
}

/**
 * If a raw message text begins with a `/mode` token, return the mode arguments
 * (everything after `/mode` on that line) plus the remaining text with the
 * token line stripped. Returns null when the text is not a `/mode` invocation.
 */
export function extractModeToken(text: string): { args: string; rest: string } | null {
  const m = text.match(/^\s*\/mode\b[ \t]*([^\n]*)(\n[\s\S]*)?$/);
  if (!m) return null;
  const args = (m[1] ?? "").trim();
  const rest = (m[2] ?? "").replace(/^\n/, "");
  return { args, rest };
}

export interface ModeHookDeps extends ModeRouteDeps {
  guard: ModeDispatchGuard;
  directory: string;
}

/** Body of the `command.execute.before` hook: authoritative `/mode` handler. */
export async function applyCommandModeHook(
  input: { command: string; sessionID: string; arguments: string },
  output: { parts: Part[] },
  deps: ModeHookDeps
): Promise<void> {
  if (input.command !== "mode") return;
  const ctx: SessionCtx = { sessionID: input.sessionID, directory: deps.directory };
  const reply = await handleModeCommand(input.arguments ?? "", ctx, deps);
  deps.guard.markHandled(input.sessionID);
  output.parts.push(makeModeTextPart(input.sessionID, reply));
}

/**
 * Body of the `chat.message` hook: fallback that handles a literally-typed
 * `/mode` token (covers the case where the command file is absent). Skips
 * re-application when command.execute.before already handled the session.
 */
export async function applyChatModeFallback(
  input: { sessionID: string },
  output: { parts: Part[] },
  deps: ModeHookDeps
): Promise<void> {
  const first = output.parts.find((p): p is Extract<Part, { type: "text" }> => p.type === "text");
  if (!first) return;
  const token = extractModeToken(first.text);
  if (!token) return;

  if (deps.guard.consume(input.sessionID)) {
    // Already handled by command.execute.before; just strip the token.
    first.text = token.rest;
    return;
  }

  const ctx: SessionCtx = { sessionID: input.sessionID, directory: deps.directory };
  const reply = await handleModeCommand(token.args, ctx, deps);
  first.text = token.rest ? `${reply}\n\n${token.rest}` : reply;
}
