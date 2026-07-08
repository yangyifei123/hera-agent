/**
 * Drive mode: who primarily drives execution within a Hera session.
 * - "auto":    AI-led via the background loop engine.
 * - "collab":  human <-> AI, turn by turn (default, today's behavior).
 * - "program": deterministic code drives; the AI is called as a function.
 *
 * Named "DriveMode" (not "Mode") to avoid collision with AgentMode,
 * LoopMode, WorkflowMode, and the team management/coordination modes.
 */
export type DriveMode = "auto" | "collab" | "program";

/**
 * The two sticky session states. "program" is an action, not a persisted
 * state, so DriveModeStore can only ever hold "auto" or "collab".
 */
export type StickyDriveMode = "auto" | "collab";

/** A brand-new session starts in collab (fully backward compatible). */
export const DEFAULT_DRIVE_MODE: DriveMode = "collab";
