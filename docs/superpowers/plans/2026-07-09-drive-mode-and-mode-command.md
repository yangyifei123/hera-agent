# Drive Mode framework + `/mode` command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, user-switchable per-session **drive mode** (`auto`/`collab`/`program`) to the Hera OpenCode plugin plus a native `/mode` command, wired to Spec 2's program engine through a frozen `ProgramRunner` seam (stubbed until Spec 2 lands), with full backward compatibility (an untouched install stays in `collab`).

**Architecture:** A new self-contained `src/mode/` module holds the drive-mode type, an in-memory per-session sticky store (`auto`/`collab` only — `program` is an action), pure command parse/render helpers, the mode-aware system-prompt addendum, the behavior router over the frozen `ProgramRunner` seam, the two OpenCode hook bodies, and a `command/mode.md` writer. `src/index.ts` constructs the store + a stub runner, writes the command file on startup, adds `command.execute.before` + `chat.message` hooks, and makes the existing `experimental.chat.system.transform` hook mode-aware — all as thin glue over the tested `src/mode/` units.

**Tech Stack:** TypeScript (strict, ESM, `bundler` module resolution), Bun (`bun:test`, `bun build`), `@opencode-ai/plugin` + `@opencode-ai/sdk` hook/`Part` types, ESLint + Prettier, existing repo utilities (`heraLog`, `atomicWriteText`, `errorMessage`).

## Global Constraints

- **Release gate (must pass before merge), verbatim:** `bun run typecheck && bun run lint && bun run build && bun test`
- **Logging:** Use `heraLog(level, message, data?)` from `src/logger.js`, never `console.*`.
- **Persisted files:** Use `atomicWriteText` / `atomicWriteJson` from `src/helpers.js` for any file written to disk (`command/mode.md`).
- **Constants:** Prefer values from `src/constants.ts` over hardcoded limits/timeouts/defaults; use `getConfigRoot()` for the OpenCode config root.
- **Tests:** Live next to source as `*.test.ts`, use `bun:test` (`describe`/`it`/`expect`/`beforeEach`/`afterEach`), temp dirs via `mkdtemp(join(tmpdir(), "prefix-"))`. Run one file with `bun test src/path/file.test.ts`.
- **Coverage:** `bunfig.toml` enforces `coverage=true` with `lines ≥ 0.90`, `functions ≥ 0.85` on **every** `bun test` run (including single-file runs). Cover every branch of each new function.
- **Formatting/lint:** Prettier is enforced by lint (`prettier/prettier: error`). Run `bun run format` after edits. `@typescript-eslint/no-unused-vars` is a warning with `argsIgnorePattern: "^_"` — prefix intentionally-unused params with `_`.
- **TypeScript:** `strict: true`. Avoid `any` in non-test files (`no-explicit-any` is a warning); test files may use `any`.
- **Drive mode is session-ephemeral:** in-memory only, no disk persistence; a new session starts in `collab`. `program` is an **action** (runs a skill now), never a persisted sticky state.
- **Seam is frozen (shared with Spec 2):** consume `ProgramRunner` / `ProgramResult` / `SessionCtx` exactly as specified; do not redefine them differently.

---

## File Structure

| File | New/Mod | Responsibility |
|------|---------|----------------|
| `src/mode/types.ts` | New | `DriveMode`, `StickyDriveMode`, `DEFAULT_DRIVE_MODE`. |
| `src/mode/store.ts` | New | `DriveModeStore`: per-session sticky mode (`auto`/`collab`), in-memory only. |
| `src/mode/command.ts` | New | Pure helpers `parseModeCommand`, `renderModeStatus` + `ModeCommand` type. |
| `src/mode/prompt.ts` | New | `driveModeSystemAddendum` (only `auto` produces text). |
| `src/mode/route.ts` | New | `StubProgramRunner`, `ModeRouteDeps`, `handleModeCommand` (behavior over parse + store + runner). |
| `src/mode/hooks.ts` | New | `ModeDispatchGuard`, `makeModeTextPart`, `extractModeToken`, `ModeHookDeps`, `applyCommandModeHook`, `applyChatModeFallback` (OpenCode hook glue). |
| `src/mode/install.ts` | New | `writeModeCommandFile` (writes `command/mode.md`, best-effort). |
| `src/types.ts` | Mod | Add frozen seam types `SessionCtx`/`ProgramResult`/`ProgramRunner`; add `PluginContext.driveModeStore` + `PluginContext.programRunner`. |
| `src/index.ts` | Mod | Construct store/runner/guard; write command file on startup; add `command.execute.before` + `chat.message` hooks; make `experimental.chat.system.transform` mode-aware. |
| `src/mode/{store,command,prompt,route,hooks,install}.test.ts` | New | One test file per module. |

**Task → file map:** Task 1 (`types.ts` + seam types + `store.ts`), Task 2 (`command.ts`), Task 3 (`prompt.ts`), Task 4 (`route.ts`), Task 5 (`hooks.ts`), Task 6 (`install.ts`), Task 7 (`src/index.ts` + `PluginContext` wiring).

---

## Task 1: Drive-mode types, frozen seam, and `DriveModeStore`

**Files:**
- Create: `src/mode/types.ts`
- Modify: `src/types.ts` (add seam types before `PluginContext`)
- Create: `src/mode/store.ts`
- Test: `src/mode/store.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - `type DriveMode = "auto" | "collab" | "program"`
  - `type StickyDriveMode = "auto" | "collab"`
  - `const DEFAULT_DRIVE_MODE: DriveMode` (value `"collab"`)
  - In `src/types.ts`: `interface SessionCtx { sessionID: string; directory: string }`, `type ProgramResult = { ok: true; value: unknown; logs: string[] } | { ok: false; error: string; logs: string[] }`, `interface ProgramRunner { run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult> }`
  - `class DriveModeStore { get(sessionID: string): StickyDriveMode; set(sessionID: string, mode: StickyDriveMode): void; clear(sessionID: string): void }`

- [ ] **Step 1: Create `src/mode/types.ts`**

```ts
// src/mode/types.ts

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
```

- [ ] **Step 2: Add the frozen seam types to `src/types.ts`**

Insert this block immediately **before** the `export interface PluginContext {` line (currently line 345):

```ts
// --- Program engine seam (frozen contract shared with the program-led engine, Spec 2) ---

/** Session identity passed to a program run. */
export interface SessionCtx {
  sessionID: string;
  directory: string;
}

/** Result of a program-skill run. */
export type ProgramResult =
  | { ok: true; value: unknown; logs: string[] }
  | { ok: false; error: string; logs: string[] };

/**
 * The ONLY dependency the drive-mode layer has on the program-led engine.
 * Spec 2 provides a concrete implementation; Spec 1 ships a stub until then.
 * Spec 2 must import these three types from here rather than redefining them.
 */
export interface ProgramRunner {
  run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult>;
}

```

- [ ] **Step 3: Verify types compile**

Run: `bun run typecheck`
Expected: PASS (no output errors; the new exported types are unused so far, which is allowed for type declarations).

- [ ] **Step 4: Write the failing test `src/mode/store.test.ts`**

```ts
// src/mode/store.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { DriveModeStore } from "./store.js";

describe("DriveModeStore", () => {
  let store: DriveModeStore;
  beforeEach(() => {
    store = new DriveModeStore();
  });

  it("defaults an unseen session to collab", () => {
    expect(store.get("s1")).toBe("collab");
  });

  it("returns a mode that was set", () => {
    store.set("s1", "auto");
    expect(store.get("s1")).toBe("auto");
  });

  it("isolates modes between sessions", () => {
    store.set("s1", "auto");
    expect(store.get("s2")).toBe("collab");
  });

  it("clear resets a session back to the default", () => {
    store.set("s1", "auto");
    store.clear("s1");
    expect(store.get("s1")).toBe("collab");
  });

  it("last write wins for the same session", () => {
    store.set("s1", "auto");
    store.set("s1", "collab");
    expect(store.get("s1")).toBe("collab");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `bun test src/mode/store.test.ts`
Expected: FAIL — bun reports `error: Cannot find module './store.js'` (store.ts not created yet).

- [ ] **Step 6: Implement `src/mode/store.ts`**

```ts
// src/mode/store.ts
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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test src/mode/store.test.ts`
Expected: PASS (`5 pass, 0 fail`).

- [ ] **Step 8: Format, typecheck, and commit**

```bash
bun run format
bun run typecheck
git add src/mode/types.ts src/types.ts src/mode/store.ts src/mode/store.test.ts
git commit -m "feat(mode): add DriveMode types, program seam, and DriveModeStore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected: `bun run typecheck` prints nothing (success); commit succeeds.

---

## Task 2: `/mode` command parsing and status rendering

**Files:**
- Create: `src/mode/command.ts`
- Test: `src/mode/command.test.ts`

**Interfaces:**
- Consumes: `DriveMode` from `src/mode/types.ts`.
- Produces:
  - `interface ModeCommand { mode?: DriveMode; skill?: string; error?: string }`
  - `function parseModeCommand(args: string): ModeCommand`
  - `function renderModeStatus(current: DriveMode): string`

Grammar (from spec §3.2): `""`/whitespace → `{}` (status, no change); `auto`/`collab` → `{ mode }`; `program <skill>` → `{ mode: "program", skill }`; `program` (no skill) → `{ error }`; anything else → `{ error }`.

- [ ] **Step 1: Write the failing test `src/mode/command.test.ts`**

```ts
// src/mode/command.test.ts
import { describe, it, expect } from "bun:test";
import { parseModeCommand, renderModeStatus } from "./command.js";

describe("parseModeCommand", () => {
  it("treats empty input as a status request (no change)", () => {
    expect(parseModeCommand("")).toEqual({});
  });

  it("treats whitespace-only input as a status request", () => {
    expect(parseModeCommand("   ")).toEqual({});
  });

  it("parses auto", () => {
    expect(parseModeCommand("auto")).toEqual({ mode: "auto" });
  });

  it("parses collab", () => {
    expect(parseModeCommand("collab")).toEqual({ mode: "collab" });
  });

  it("is case-insensitive on the verb", () => {
    expect(parseModeCommand("AUTO")).toEqual({ mode: "auto" });
  });

  it("parses program with a skill name", () => {
    expect(parseModeCommand("program deploy")).toEqual({ mode: "program", skill: "deploy" });
  });

  it("ignores extra tokens after the program skill name", () => {
    expect(parseModeCommand("program deploy now")).toEqual({ mode: "program", skill: "deploy" });
  });

  it("errors on program without a skill name", () => {
    const r = parseModeCommand("program");
    expect(r.mode).toBeUndefined();
    expect(r.error).toContain("skill name is required");
  });

  it("errors on an unknown verb", () => {
    const r = parseModeCommand("wat");
    expect(r.mode).toBeUndefined();
    expect(r.error).toContain('Unknown mode "wat"');
    expect(r.error).toContain("auto, collab, program");
  });
});

describe("renderModeStatus", () => {
  it("shows the current mode and usage", () => {
    const s = renderModeStatus("collab");
    expect(s).toContain("Drive mode: collab");
    expect(s).toContain("/mode auto");
    expect(s).toContain("/mode program <skill>");
  });

  it("reflects the auto mode when current", () => {
    expect(renderModeStatus("auto")).toContain("Drive mode: auto");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/mode/command.test.ts`
Expected: FAIL — bun reports `error: Cannot find module './command.js'`.

- [ ] **Step 3: Implement `src/mode/command.ts`**

```ts
// src/mode/command.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/mode/command.test.ts`
Expected: PASS (`11 pass, 0 fail`).

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/mode/command.ts src/mode/command.test.ts
git commit -m "feat(mode): parse /mode arguments and render mode status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Mode-aware system-prompt addendum

**Files:**
- Create: `src/mode/prompt.ts`
- Test: `src/mode/prompt.test.ts`

**Interfaces:**
- Consumes: `DriveMode` from `src/mode/types.ts`; `SessionCtx` from `src/types.ts`.
- Produces: `function driveModeSystemAddendum(mode: DriveMode, ctx: SessionCtx): string | null` — non-null only for `auto`; `null` for `collab` and `program`.

- [ ] **Step 1: Write the failing test `src/mode/prompt.test.ts`**

```ts
// src/mode/prompt.test.ts
import { describe, it, expect } from "bun:test";
import { driveModeSystemAddendum } from "./prompt.js";

const ctx = { sessionID: "s1", directory: "/tmp/x" };

describe("driveModeSystemAddendum", () => {
  it("returns null for collab (no addendum, byte-identical to today)", () => {
    expect(driveModeSystemAddendum("collab", ctx)).toBeNull();
  });

  it("returns a non-empty autonomy directive for auto", () => {
    const s = driveModeSystemAddendum("auto", ctx);
    expect(s).not.toBeNull();
    expect(s).toContain("auto");
    expect(s).toContain("hera_enqueue_task");
    expect(s).toContain("hera_create_loop");
  });

  it("returns null for program (no chat turn to shape)", () => {
    expect(driveModeSystemAddendum("program", ctx)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/mode/prompt.test.ts`
Expected: FAIL — bun reports `error: Cannot find module './prompt.js'`.

- [ ] **Step 3: Implement `src/mode/prompt.ts`**

```ts
// src/mode/prompt.ts
import type { DriveMode } from "./types.js";
import type { SessionCtx } from "../types.js";

const AUTO_ADDENDUM = [
  "## Drive mode: auto (AI-led)",
  "",
  "You are running in AUTONOMOUS drive mode. Treat the user's latest message as a",
  "goal plus bounds plus process, not a turn in a conversation. Minimize",
  "back-and-forth: do not ask clarifying questions unless a required bound is",
  "missing and blocks all progress. Drive the work through the durable engine —",
  "enqueue background work with hera_enqueue_task and create recurring/iterating",
  "work with hera_create_loop — rather than doing it inline turn by turn. Report",
  "only when the work is complete or genuinely blocked.",
].join("\n");

/**
 * Mode-specific text appended to Hera's system prompt.
 * - collab  -> null (today's behavior, no addendum).
 * - auto    -> the autonomy directive.
 * - program -> null (a program run executes in Spec 2's child process, not
 *              through a Hera chat turn, so there is no prompt to shape).
 *
 * `_ctx` is reserved for future per-directory/per-session addenda; unused today.
 */
export function driveModeSystemAddendum(mode: DriveMode, _ctx: SessionCtx): string | null {
  if (mode === "auto") return AUTO_ADDENDUM;
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/mode/prompt.test.ts`
Expected: PASS (`3 pass, 0 fail`).

- [ ] **Step 5: Format, typecheck, and commit**

```bash
bun run format
bun run typecheck
git add src/mode/prompt.ts src/mode/prompt.test.ts
git commit -m "feat(mode): add auto-mode system-prompt addendum

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Program-seam consumption and command behavior (`route.ts`)

**Files:**
- Create: `src/mode/route.ts`
- Test: `src/mode/route.test.ts`

**Interfaces:**
- Consumes: `parseModeCommand`, `renderModeStatus` from `src/mode/command.ts`; `DriveModeStore` from `src/mode/store.ts`; `StickyDriveMode` from `src/mode/types.ts`; `ProgramRunner`, `ProgramResult`, `SessionCtx` from `src/types.ts`; `errorMessage` from `src/helpers.ts`.
- Produces:
  - `class StubProgramRunner implements ProgramRunner` (returns `{ ok:false, error:"program engine not yet available", logs: [] }`).
  - `interface ModeRouteDeps { store: DriveModeStore; runner: ProgramRunner }`
  - `function handleModeCommand(args: string, ctx: SessionCtx, deps: ModeRouteDeps): Promise<string>` — sets the sticky store (`auto`/`collab`), runs a program skill (`program`, never mutating the sticky mode), or returns a status/error reply. Never throws.

- [ ] **Step 1: Write the failing test `src/mode/route.test.ts`**

```ts
// src/mode/route.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { StubProgramRunner, handleModeCommand } from "./route.js";
import { DriveModeStore } from "./store.js";
import type { ProgramRunner, ProgramResult, SessionCtx } from "../types.js";

const CTX: SessionCtx = { sessionID: "s1", directory: "/work" };

class FakeRunner implements ProgramRunner {
  calls: Array<{ skill: string; args: unknown; ctx: SessionCtx }> = [];
  constructor(private result: ProgramResult | (() => Promise<ProgramResult>)) {}
  async run(skill: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult> {
    this.calls.push({ skill, args, ctx });
    return typeof this.result === "function" ? this.result() : this.result;
  }
}

describe("StubProgramRunner", () => {
  it("always reports the engine is unavailable", async () => {
    const r = await new StubProgramRunner().run("x", {}, CTX);
    expect(r).toEqual({ ok: false, error: "program engine not yet available", logs: [] });
  });
});

describe("handleModeCommand", () => {
  let store: DriveModeStore;
  beforeEach(() => {
    store = new DriveModeStore();
  });

  it("returns the status text for an empty command and changes nothing", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("", CTX, { store, runner });
    expect(reply).toContain("Drive mode: collab");
    expect(runner.calls).toHaveLength(0);
  });

  it("sets the sticky mode to auto and confirms", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("auto", CTX, { store, runner });
    expect(reply).toContain("auto");
    expect(store.get("s1")).toBe("auto");
  });

  it("sets the sticky mode to collab", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    store.set("s1", "auto");
    await handleModeCommand("collab", CTX, { store, runner });
    expect(store.get("s1")).toBe("collab");
  });

  it("returns the parse error and leaves the mode unchanged for garbage", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("wat", CTX, { store, runner });
    expect(reply).toContain('Unknown mode "wat"');
    expect(store.get("s1")).toBe("collab");
  });

  it("routes a program run to the runner with the parsed skill and ctx", async () => {
    const runner = new FakeRunner({ ok: true, value: "done", logs: ["step 1"] });
    const reply = await handleModeCommand("program deploy", CTX, { store, runner });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].skill).toBe("deploy");
    expect(runner.calls[0].ctx).toEqual(CTX);
    expect(reply).toContain("deploy");
    expect(reply).toContain("done");
    expect(reply).toContain("step 1");
  });

  it("does not change the sticky mode when running a program", async () => {
    const runner = new FakeRunner({ ok: true, value: "ok", logs: [] });
    store.set("s1", "auto");
    await handleModeCommand("program deploy", CTX, { store, runner });
    expect(store.get("s1")).toBe("auto");
  });

  it("errors (and does not call the runner) when program has no skill", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("program", CTX, { store, runner });
    expect(reply).toContain("skill name is required");
    expect(runner.calls).toHaveLength(0);
  });

  it("renders a failed program result", async () => {
    const runner = new FakeRunner({ ok: false, error: "boom", logs: ["log a"] });
    const reply = await handleModeCommand("program deploy", CTX, { store, runner });
    expect(reply).toContain("failed");
    expect(reply).toContain("boom");
    expect(reply).toContain("log a");
  });

  it("catches a runner that throws and renders it as a failure", async () => {
    const runner = new FakeRunner(async () => {
      throw new Error("kaboom");
    });
    const reply = await handleModeCommand("program deploy", CTX, { store, runner });
    expect(reply).toContain("failed");
    expect(reply).toContain("kaboom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/mode/route.test.ts`
Expected: FAIL — bun reports `error: Cannot find module './route.js'`.

- [ ] **Step 3: Implement `src/mode/route.ts`**

```ts
// src/mode/route.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/mode/route.test.ts`
Expected: PASS (`10 pass, 0 fail`).

- [ ] **Step 5: Format, typecheck, and commit**

```bash
bun run format
bun run typecheck
git add src/mode/route.ts src/mode/route.test.ts
git commit -m "feat(mode): route /mode commands over the program-runner seam with a stub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: OpenCode hook glue (`hooks.ts`)

**Files:**
- Create: `src/mode/hooks.ts`
- Test: `src/mode/hooks.test.ts`

**Interfaces:**
- Consumes: `Part` from `@opencode-ai/sdk`; `handleModeCommand`, `ModeRouteDeps` from `src/mode/route.ts`; `SessionCtx` from `src/types.ts`.
- Produces:
  - `class ModeDispatchGuard { markHandled(sessionID: string): void; consume(sessionID: string): boolean }`
  - `function makeModeTextPart(sessionID: string, text: string): Part`
  - `function extractModeToken(text: string): { args: string; rest: string } | null`
  - `interface ModeHookDeps extends ModeRouteDeps { guard: ModeDispatchGuard; directory: string }`
  - `function applyCommandModeHook(input: { command: string; sessionID: string; arguments: string }, output: { parts: Part[] }, deps: ModeHookDeps): Promise<void>`
  - `function applyChatModeFallback(input: { sessionID: string }, output: { parts: Part[] }, deps: ModeHookDeps): Promise<void>`

- [ ] **Step 1: Write the failing test `src/mode/hooks.test.ts`**

```ts
// src/mode/hooks.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import {
  ModeDispatchGuard,
  makeModeTextPart,
  extractModeToken,
  applyCommandModeHook,
  applyChatModeFallback,
} from "./hooks.js";
import { DriveModeStore } from "./store.js";
import { StubProgramRunner } from "./route.js";
import type { ProgramRunner, ProgramResult, SessionCtx } from "../types.js";

function textPart(text: string): any {
  return { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text };
}

class FakeRunner implements ProgramRunner {
  calls: Array<{ skill: string; ctx: SessionCtx }> = [];
  constructor(private result: ProgramResult) {}
  async run(skill: string, _args: unknown, ctx: SessionCtx): Promise<ProgramResult> {
    this.calls.push({ skill, ctx });
    return this.result;
  }
}

describe("ModeDispatchGuard", () => {
  it("consume is false without a prior mark", () => {
    expect(new ModeDispatchGuard().consume("s1")).toBe(false);
  });

  it("consume is true exactly once after markHandled", () => {
    const g = new ModeDispatchGuard();
    g.markHandled("s1");
    expect(g.consume("s1")).toBe(true);
    expect(g.consume("s1")).toBe(false);
  });
});

describe("makeModeTextPart", () => {
  it("builds a synthetic text part carrying the reply", () => {
    const part = makeModeTextPart("s1", "hello") as any;
    expect(part.type).toBe("text");
    expect(part.text).toBe("hello");
    expect(part.sessionID).toBe("s1");
    expect(part.synthetic).toBe(true);
    expect(typeof part.id).toBe("string");
  });
});

describe("extractModeToken", () => {
  it("returns null for non-/mode text", () => {
    expect(extractModeToken("hello world")).toBeNull();
  });

  it("does not match /mode as a prefix of a longer word", () => {
    expect(extractModeToken("/modexyz")).toBeNull();
  });

  it("extracts args for a leading /mode token", () => {
    expect(extractModeToken("/mode auto")).toEqual({ args: "auto", rest: "" });
  });

  it("extracts empty args for a bare /mode", () => {
    expect(extractModeToken("/mode")).toEqual({ args: "", rest: "" });
  });

  it("tolerates leading whitespace and keeps trailing lines as rest", () => {
    expect(extractModeToken("  /mode program deploy\nplease")).toEqual({
      args: "program deploy",
      rest: "please",
    });
  });
});

describe("applyCommandModeHook", () => {
  let store: DriveModeStore;
  let guard: ModeDispatchGuard;
  beforeEach(() => {
    store = new DriveModeStore();
    guard = new ModeDispatchGuard();
  });

  it("ignores commands other than mode", async () => {
    const output = { parts: [] as any[] };
    await applyCommandModeHook({ command: "other", sessionID: "s1", arguments: "" }, output, {
      store,
      runner: new StubProgramRunner(),
      guard,
      directory: "/d",
    });
    expect(output.parts).toHaveLength(0);
  });

  it("sets the sticky mode, marks the guard, and pushes a reply part", async () => {
    const output = { parts: [] as any[] };
    await applyCommandModeHook({ command: "mode", sessionID: "s1", arguments: "auto" }, output, {
      store,
      runner: new StubProgramRunner(),
      guard,
      directory: "/d",
    });
    expect(store.get("s1")).toBe("auto");
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].text).toContain("auto");
    expect(guard.consume("s1")).toBe(true);
  });

  it("routes a program run to the runner", async () => {
    const runner = new FakeRunner({ ok: true, value: "ok", logs: [] });
    const output = { parts: [] as any[] };
    await applyCommandModeHook(
      { command: "mode", sessionID: "s1", arguments: "program deploy" },
      output,
      { store, runner, guard, directory: "/work" }
    );
    expect(runner.calls[0].skill).toBe("deploy");
    expect(runner.calls[0].ctx).toEqual({ sessionID: "s1", directory: "/work" });
    expect(output.parts[0].text).toContain("deploy");
  });
});

describe("applyChatModeFallback", () => {
  let store: DriveModeStore;
  let guard: ModeDispatchGuard;
  const deps = () => ({ store, runner: new StubProgramRunner(), guard, directory: "/d" });
  beforeEach(() => {
    store = new DriveModeStore();
    guard = new ModeDispatchGuard();
  });

  it("does nothing when the first text part is not a /mode token", async () => {
    const output = { parts: [textPart("just chatting")] };
    await applyChatModeFallback({ sessionID: "s1" }, output, deps());
    expect(output.parts[0].text).toBe("just chatting");
    expect(store.get("s1")).toBe("collab");
  });

  it("applies a literal /mode token, sets the mode, and strips the token", async () => {
    const output = { parts: [textPart("/mode auto")] };
    await applyChatModeFallback({ sessionID: "s1" }, output, deps());
    expect(store.get("s1")).toBe("auto");
    expect(output.parts[0].text).toContain("auto");
    expect(output.parts[0].text.startsWith("/mode")).toBe(false);
  });

  it("only strips (does not re-apply) when a command run was already handled", async () => {
    guard.markHandled("s1");
    store.set("s1", "collab"); // sentinel: fallback must NOT flip this to auto
    const output = { parts: [textPart("/mode auto")] };
    await applyChatModeFallback({ sessionID: "s1" }, output, deps());
    expect(store.get("s1")).toBe("collab");
    expect(output.parts[0].text).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/mode/hooks.test.ts`
Expected: FAIL — bun reports `error: Cannot find module './hooks.js'`.

- [ ] **Step 3: Implement `src/mode/hooks.ts`**

```ts
// src/mode/hooks.ts
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
  const first = output.parts.find(
    (p): p is Extract<Part, { type: "text" }> => p.type === "text"
  );
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/mode/hooks.test.ts`
Expected: PASS (`13 pass, 0 fail`).

- [ ] **Step 5: Format, typecheck, and commit**

```bash
bun run format
bun run typecheck
git add src/mode/hooks.ts src/mode/hooks.test.ts
git commit -m "feat(mode): add /mode OpenCode hook glue and dispatch guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `command/mode.md` writer (`install.ts`)

**Files:**
- Create: `src/mode/install.ts`
- Test: `src/mode/install.test.ts`

**Interfaces:**
- Consumes: `atomicWriteText`, `errorMessage` from `src/helpers.ts`; `heraLog` from `src/logger.ts`.
- Produces:
  - `const MODE_COMMAND_MARKDOWN: string`
  - `function writeModeCommandFile(configRoot: string): Promise<void>` — writes `<configRoot>/command/mode.md`; idempotent; best-effort (logs at `warn` and swallows on failure).

- [ ] **Step 1: Write the failing test `src/mode/install.test.ts`**

```ts
// src/mode/install.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModeCommandFile, MODE_COMMAND_MARKDOWN } from "./install.js";

describe("writeModeCommandFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mode-install-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes command/mode.md under the config root", async () => {
    await writeModeCommandFile(dir);
    const content = await readFile(join(dir, "command", "mode.md"), "utf-8");
    expect(content).toBe(MODE_COMMAND_MARKDOWN);
    expect(content).toContain("agent: hera");
    expect(content).toContain("/mode program <skill>");
  });

  it("is idempotent (second write keeps identical content)", async () => {
    await writeModeCommandFile(dir);
    await writeModeCommandFile(dir);
    const content = await readFile(join(dir, "command", "mode.md"), "utf-8");
    expect(content).toBe(MODE_COMMAND_MARKDOWN);
  });

  it("swallows write failures (best effort) and does not throw", async () => {
    // Make <dir>/command a FILE so mkdir(<dir>/command) throws; the writer must
    // catch, log at warn, and return without throwing, leaving the file intact.
    await writeFile(join(dir, "command"), "x", "utf-8");
    await writeModeCommandFile(dir);
    const content = await readFile(join(dir, "command"), "utf-8");
    expect(content).toBe("x");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/mode/install.test.ts`
Expected: FAIL — bun reports `error: Cannot find module './install.js'`.

- [ ] **Step 3: Implement `src/mode/install.ts`**

```ts
// src/mode/install.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/mode/install.test.ts`
Expected: PASS (`3 pass, 0 fail`).

- [ ] **Step 5: Format, typecheck, and commit**

```bash
bun run format
bun run typecheck
git add src/mode/install.ts src/mode/install.test.ts
git commit -m "feat(mode): write command/mode.md for native /mode discovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire drive mode into the plugin runtime (`src/index.ts` + `PluginContext`)

**Files:**
- Modify: `src/types.ts` (add `driveModeStore` + `programRunner` to `PluginContext`, currently lines 345-360)
- Modify: `src/index.ts` (imports; construct store/runner/guard; write command file; `ctx` fields; mode-aware `experimental.chat.system.transform`; add `command.execute.before` + `chat.message` hooks)

**Interfaces:**
- Consumes: `DriveModeStore` from `src/mode/store.ts`; `StubProgramRunner` from `src/mode/route.ts`; `ModeDispatchGuard`, `applyCommandModeHook`, `applyChatModeFallback` from `src/mode/hooks.ts`; `writeModeCommandFile` from `src/mode/install.ts`; `driveModeSystemAddendum` from `src/mode/prompt.ts`; `ProgramRunner` from `src/types.ts`.
- Produces: `PluginContext.driveModeStore: DriveModeStore`, `PluginContext.programRunner: ProgramRunner` (Spec 2 later swaps the stub for the real runner). No new unit test file — all logic lives in the already-tested `src/mode/` modules; this task is verified by `bun run typecheck` + the full `bun test` suite. Backward compatibility is guaranteed by construction (`driveModeSystemAddendum("collab", …)` returns `null`, tested in Task 3, so `output.system` is byte-identical to today when no `/mode` is used).

- [ ] **Step 1: Add the two fields to `PluginContext` in `src/types.ts`**

Find (currently the tail of `PluginContext`, lines 357-360):

```ts
  config: HeraConfig;
  paths: HeraPaths;
  autoEvolve: boolean;
}
```

Replace with:

```ts
  config: HeraConfig;
  paths: HeraPaths;
  autoEvolve: boolean;
  driveModeStore: import("./mode/store.js").DriveModeStore;
  /** Program-led engine seam (Spec 2). Spec 1 wires a StubProgramRunner. */
  programRunner: ProgramRunner;
}
```

- [ ] **Step 2: Add imports to `src/index.ts`**

Find (line 18):

```ts
import { isFirstRun, runOnboarding } from "./onboarding.js";
```

Replace with:

```ts
import { isFirstRun, runOnboarding } from "./onboarding.js";
import { DriveModeStore } from "./mode/store.js";
import { StubProgramRunner } from "./mode/route.js";
import {
  ModeDispatchGuard,
  applyCommandModeHook,
  applyChatModeFallback,
} from "./mode/hooks.js";
import { writeModeCommandFile } from "./mode/install.js";
import { driveModeSystemAddendum } from "./mode/prompt.js";
```

- [ ] **Step 3: Construct the store/runner/guard and write the command file**

Find (lines 163-166):

```ts
  const { taskStore, loopManager, supervisor } = engine;

  // Ensure hera itself has a .md file for OpenCode native discovery
  await agentRegistry.ensureHeraMd(config);
```

Replace with:

```ts
  const { taskStore, loopManager, supervisor } = engine;

  // Drive mode: per-session sticky mode (in-memory) + a stub program runner
  // (Spec 2 replaces the stub with the real ProgramRunner) + a dispatch guard
  // shared by the two /mode hooks.
  const driveModeStore = new DriveModeStore();
  const programRunner = new StubProgramRunner();
  const modeGuard = new ModeDispatchGuard();

  // Ensure hera itself has a .md file for OpenCode native discovery
  await agentRegistry.ensureHeraMd(config);

  // Make /mode discoverable in OpenCode's native `/` autocomplete (best-effort).
  await writeModeCommandFile(configRoot);
```

- [ ] **Step 4: Add the two fields to the `ctx` object**

Find (lines 206-210):

```ts
    config,
    paths,
    autoEvolve: config.auto_evolve === true,
  };
```

Replace with:

```ts
    config,
    paths,
    autoEvolve: config.auto_evolve === true,
    driveModeStore,
    programRunner,
  };
```

- [ ] **Step 5: Make `experimental.chat.system.transform` mode-aware**

Find (lines 309-314, the end of the Hera-only roster block):

```ts
        const skills = skillManager.getAllSkills();
        const skillList = skills
          .map((s) => `- **${s.name}** (${s.category}): ${s.description}`)
          .join("\n");
        output.system.push(`\n## Available Skills\n\n${skillList}`);
      }
```

Replace with:

```ts
        const skills = skillManager.getAllSkills();
        const skillList = skills
          .map((s) => `- **${s.name}** (${s.category}): ${s.description}`)
          .join("\n");
        output.system.push(`\n## Available Skills\n\n${skillList}`);

        // Drive-mode addendum (Hera only). collab -> null (byte-identical to
        // today); auto -> the autonomy directive; program -> null. A missing
        // sessionID is treated as collab (safe default).
        const driveMode = driveModeStore.get(input.sessionID ?? "");
        const addendum = driveModeSystemAddendum(driveMode, {
          sessionID: input.sessionID ?? "",
          directory,
        });
        if (addendum) output.system.push(addendum);
      }
```

- [ ] **Step 6: Add the `command.execute.before` and `chat.message` hooks**

Find (line 274, inside the `hooks` object):

```ts
    tool: tools,
```

Replace with:

```ts
    tool: tools,

    async "command.execute.before"(input, output) {
      await applyCommandModeHook(input, output, {
        store: driveModeStore,
        runner: programRunner,
        guard: modeGuard,
        directory,
      });
    },

    async "chat.message"(input, output) {
      await applyChatModeFallback(input, output, {
        store: driveModeStore,
        runner: programRunner,
        guard: modeGuard,
        directory,
      });
    },
```

- [ ] **Step 7: Typecheck, lint, and format**

Run: `bun run typecheck`
Expected: PASS (no errors).

Run: `bun run lint`
Expected: PASS (0 errors; warnings on pre-existing code are acceptable, but no new errors).

Run: `bun run format`
Expected: reformats touched files with no diff on already-formatted code.

- [ ] **Step 8: Run the full suite and the build**

Run: `bun test`
Expected: PASS — all `src/mode/*.test.ts` green plus the pre-existing suite; coverage stays above the `bunfig.toml` floor (`lines ≥ 0.90`, `functions ≥ 0.85`). If coverage dips because of the thin `index.ts` glue, note that all branch logic is already covered by `src/mode/hooks.test.ts`, `route.test.ts`, and `prompt.test.ts`.

Run: `bun run build`
Expected: prints `build done` with no errors (confirms the new module bundles and `.d.ts` emit succeeds).

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat(mode): wire drive mode + /mode hooks into the plugin runtime

Construct DriveModeStore and a StubProgramRunner on startup, write
command/mode.md, add command.execute.before + chat.message hooks, and make
experimental.chat.system.transform mode-aware. collab is unchanged, so an
untouched install is byte-identical to before.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 10: Run the release gate**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: all four stages pass in sequence.

---

## Self-Review

**1. Spec coverage** (each spec section maps to a task):

- §2 Naming (`DriveMode`, `DEFAULT_DRIVE_MODE`) → Task 1 (`src/mode/types.ts`).
- §3 Architecture module layout (`types`/`store`/`command`/`prompt`) → Tasks 1-3; `PluginContext.driveModeStore` → Task 7.
- §3 `DriveModeStore` (default collab, `get`/`set`/`clear`, in-memory, sticky auto/collab only) → Task 1.
- §3.1 Two-part command surface (command file + `command.execute.before`, `chat.message` fallback, authority/guard) → Task 6 (`install.ts`) + Task 5 (`hooks.ts`, `ModeDispatchGuard`) + Task 7 (wiring).
- §3.2 Command grammar (status / auto / collab / program <skill> / garbage) → Task 2 (`parseModeCommand`) + Task 4 (`handleModeCommand` behavior, program does not mutate sticky mode).
- §4 Data flow: collab (no change) → Task 3 (`null` addendum) + Task 7 (byte-identical); auto (autonomy directive via transform) → Task 3 + Task 7; program (`ProgramRunner` seam, terse result, sticky untouched, stub until Spec 2) → Task 1 (seam) + Task 4 (`StubProgramRunner`, routing) + Task 5/7 (hook).
- §5 Mode-aware system prompt (append `driveModeSystemAddendum`, Hera-only guard, only `auto`) → Task 3 + Task 7 Step 5.
- §6 Error handling (garbage → parse error; runner throws → caught failure; command-file write fails → warn+continue; missing sessionID → collab; concurrent → last write wins) → Task 4 (garbage, throw), Task 6 (write failure), Task 7 Step 5 (missing sessionID), Task 1 store (last write wins test).
- §7 Testing (store / command / prompt / index-integration / backward-compat) → Tasks 1-7 test files; index-integration is covered by the extracted-and-tested `applyCommandModeHook`/`applyChatModeFallback`; backward-compat by `driveModeSystemAddendum("collab") === null`.
- §8 Files touched → File Structure table.
- §9 Frozen seam → Task 1 (seam types in `src/types.ts`), Task 4 (`StubProgramRunner`), consumed verbatim.

**2. Placeholder scan:** No `TBD`/`TODO`/"similar to Task N"/"add error handling" — every code step contains complete source and every command an expected result.

**3. Type consistency:** `handleModeCommand(args, ctx, deps)`, `ModeRouteDeps { store, runner }`, `ModeHookDeps extends ModeRouteDeps { guard, directory }`, `applyCommandModeHook`/`applyChatModeFallback`, `ModeDispatchGuard.markHandled`/`consume`, `makeModeTextPart`, `extractModeToken`, `driveModeSystemAddendum(mode, ctx)`, and the seam `ProgramRunner`/`ProgramResult`/`SessionCtx` are used with identical names/signatures across every task that references them.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-drive-mode-and-mode-command.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints.

**Which approach?**
