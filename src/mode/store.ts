import type { StickyDriveMode } from "./types.js";

/**
 * Per-session sticky drive mode, IN-MEMORY ONLY. Drive mode is
 * session-ephemeral: it must NOT persist across restarts (there are no disk
 * writes here). Only "auto"/"collab" are ever stored — "program" is an action,
 * not a persisted state.
 */
export class DriveModeStore {
  private modes = new Map<string, StickyDriveMode>();

  /** Current sticky mode for a session; defaults to collab (== DEFAULT_DRIVE_MODE). */
  get(sessionID: string): StickyDriveMode {
    return this.modes.get(sessionID) ?? "collab";
  }

  /** Set the sticky mode for a session (auto or collab only). */
  set(sessionID: string, mode: StickyDriveMode): void {
    this.modes.set(sessionID, mode);
  }

  /** Reset a session back to the default (collab). */
  clear(sessionID: string): void {
    this.modes.delete(sessionID);
  }
}
