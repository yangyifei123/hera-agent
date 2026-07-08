# Design: Drive Mode framework + `/mode` command (Spec 1 of 2)

Date: 2026-07-08
Status: Draft for review
Companion: `2026-07-08-program-led-engine-design.md` (Spec 2 — the program-led engine)

## 1. Purpose

Hera today is LLM-led everywhere: Hera itself and every agent it generates are
driven by the model, always conversational. This spec introduces an explicit,
user-switchable **drive mode** — *who primarily drives execution* — scoped to a
Hera session, plus a native `/mode` command to switch it.

Three drive modes, one axis ("who drives"):

| Drive mode | Driver | Human role | Backing engine |
|------------|--------|-----------|----------------|
| `auto` | AI | Sets goal / bounds / process up front, then hands off | the background **loop** engine (`src/engine/`) |
| `collab` (default) | Human ↔ AI | In the loop, turn by turn | current Hera behavior (unchanged) |
| `program` | Deterministic code | Authors a program skill; AI is called as a function | the **program engine** (Spec 2) |

Non-goals for this spec: the program engine itself (Spec 2). This spec only
wires `program` mode to Spec 2's `ProgramRunner` through a fixed interface.

## 2. Naming (avoid collision)

`mode` is already overloaded in the codebase: `AgentMode`
(`primary|subagent|all`), `LoopMode`, `WorkflowMode`, team management mode,
coordination mode. The new concept is therefore named **`DriveMode`** in code
to avoid collision. User-facing, the command is `/mode` and the values are
`auto` / `collab` / `program`.

```ts
// src/mode/types.ts
export type DriveMode = "auto" | "collab" | "program";
export const DEFAULT_DRIVE_MODE: DriveMode = "collab";
```

## 3. Architecture

New module `src/mode/`:

- `src/mode/types.ts` — `DriveMode`, `DEFAULT_DRIVE_MODE`.
- `src/mode/store.ts` — `DriveModeStore`: a per-session in-memory map holding the
  **sticky** session mode, which is only ever `auto` or `collab` (`program` is an
  action, not a persisted state — see §3.2). `get(sessionID)` defaults to
  `collab`; `set(sessionID, "auto"|"collab")`; `clear(sessionID)`. In-memory
  only: drive mode is session-ephemeral and must not persist across restarts (a
  new session starts in `collab`). No disk writes.
- `src/mode/command.ts` — pure helpers: `parseModeCommand(arguments: string):
  { mode?: DriveMode; skill?: string; error?: string }` and
  `renderModeStatus(current: DriveMode): string` (the `/mode` help/status text).
- `src/mode/prompt.ts` — `driveModeSystemAddendum(mode, ctx): string | null`:
  the mode-specific text appended to Hera's system prompt (see §5).

The `PluginContext` gains `driveModeStore: DriveModeStore`. It is constructed in
`src/index.ts` startup alongside the other stores.

### 3.1 The `/mode` command surface (two-part, per OpenCode reality)

OpenCode plugins **cannot register a slash command via the `Hooks` API**.
Commands are a native config/markdown concept (`Command.source` ∈
`command|mcp|skill`). See memory `opencode-command-mechanism`. So `/mode` is
delivered in two parts:

1. **Discoverability** — Hera writes a command file
   `join(configRoot, "command", "mode.md")` on startup (idempotent, like it
   already writes `hera.md` and agent `.md` files). This makes `/mode` appear in
   OpenCode's native `/` autocomplete. Its front-matter routes to the `hera`
   agent; its body is a minimal template instructing behavior (the real logic is
   the hook below, not the template).

2. **Behavior** — Hera adds a `command.execute.before` hook:
   ```ts
   "command.execute.before"(input: { command: string; sessionID: string; arguments: string },
                            output: { parts: Part[] }) {
     if (input.command !== "mode") return;
     const parsed = parseModeCommand(input.arguments);
     // set driveModeStore, then populate output.parts with a confirmation /
     // status message (collab/auto) or a program-run acknowledgement (program).
   }
   ```
   Fallback: a `chat.message` hook also scans `output.parts` for a leading
   `/mode …` token (covers the case where the command file is absent or the user
   types it as literal text), applying the same `parseModeCommand` logic and
   stripping the token. `command.execute.before` is authoritative when both fire;
   the `chat.message` path is guarded to only act when no command run is in
   progress for that message, to avoid double-application.

### 3.2 Command grammar

| Input | Effect |
|-------|--------|
| `/mode` | Reply with current mode + one-line help (`renderModeStatus`). No change. |
| `/mode auto` | Set session → `auto` (sticky). Confirm. |
| `/mode collab` | Set session → `collab` (sticky). Confirm. |
| `/mode program <skill>` | **Action:** invoke Spec 2's runner for `<skill>` now (see §4). Does **not** change the sticky mode. |
| `/mode <garbage>` | Reply with the parse error + valid values. No change. |

`auto` and `collab` are the two **sticky** session states. `program` is an
**action**, not a sticky state: `/mode program <skill>` runs that skill's
procedure to completion and reports; the session's sticky mode (whatever it was,
e.g. `collab`) is left untouched. This keeps the model honest — a program run is
bounded, so there is nothing to "stay in" and no prior mode to restore. The three
drive modes remain the three conceptual drivers; `program` simply manifests as an
invocation rather than a persistent chat posture.

## 4. Data flow

### collab (default)
No change. `driveModeStore.get(sessionID)` returns `collab`; no system-prompt
addendum; all existing hooks behave exactly as today. **Backward compatibility
is by construction** — an untouched install never leaves `collab`.

### auto
- `/mode auto` sets the session mode.
- On subsequent turns, the `experimental.chat.system.transform` hook (already
  present, made mode-aware in §5) appends an **autonomy directive**: Hera should
  minimize back-and-forth, treat the user's message as goal+bounds+process, and
  drive the work through the loop/task tools (`hera_create_loop`,
  `hera_enqueue_task`, …) rather than conversational turns; report on completion.
- No new engine is built: this is a behavior shift of the existing Hera agent
  toward the loop engine. (A future iteration may auto-materialize a loop from
  the message without model mediation; out of scope here.)

### program
- `/mode program <skill>` calls the fixed seam interface (implemented by Spec 2):
  ```ts
  // The ONLY dependency Spec 1 has on Spec 2:
  interface ProgramRunner {
    run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult>;
  }
  type ProgramResult =
    | { ok: true; value: unknown; logs: string[] }
    | { ok: false; error: string; logs: string[] };
  interface SessionCtx { sessionID: string; directory: string; }
  ```
- `command.execute.before` invokes `programRunner.run(skill, args, ctx)` and
  populates `output.parts` with a terse result summary (Hera "doesn't chatter" —
  it reports the program's outcome + logs, not a conversational reply). The
  sticky mode is not mutated (program is an action, §3.2).
- If the skill is missing or has no `program` entry, reply with a clear error.
- `programRunner` is provided on `PluginContext` by Spec 2. Until Spec 2 lands, a
  stub runner returns `{ ok:false, error:"program engine not yet available" }`,
  so Spec 1 is independently testable and shippable.

## 5. Mode-aware system prompt

`src/index.ts`'s `experimental.chat.system.transform` hook currently appends the
team/agent/skill roster for Hera. Extend it: after the roster, append
`driveModeSystemAddendum(driveModeStore.get(sessionID), ctx)`:

- `collab` → `null` (no addendum; today's behavior).
- `auto` → the autonomy directive (§4).

`program` needs no system-prompt addendum: a program run executes in Spec 2's
child process (code-driven), not through Hera's chat turn, so there is no Hera
prompt to shape. `driveModeSystemAddendum` therefore only handles `auto`.

The hook stays guarded so **only Hera** (not child agents) receives this.

## 6. Error handling

- Unknown/garbage `/mode` argument → parse error reply, no state change.
- `program` run throws / rejects → caught by the runner (Spec 2) and returned as
  `{ ok:false, error }`; Spec 1 renders it. Sticky mode is restored regardless.
- Writing `command/mode.md` fails (permissions) → log at `warn`, continue; the
  `chat.message` fallback still makes `/mode` work without the file.
- Missing `sessionID` on a hook input → treat as `collab` (safe default), never
  throw.
- Concurrent `/mode` on the same session → last write wins on the map; harmless.

## 7. Testing

- `src/mode/store.test.ts` — default is `collab`; set/get/clear per session;
  isolation between session ids.
- `src/mode/command.test.ts` — `parseModeCommand` for every grammar row in §3.2
  including garbage and `program` with/without a skill name; `renderModeStatus`.
- `src/mode/prompt.test.ts` — addendum is `null` for `collab`, non-empty for
  `auto` (program has no addendum).
- `src/index` integration (light): `command.execute.before` with `command:"mode"`
  sets the store and populates `output.parts`; a non-`mode` command is ignored;
  the `chat.message` fallback strips a leading `/mode` token. Use a fake
  `programRunner` stub to assert `program` routes to it with the parsed skill.
- Backward-compat guard: with no `/mode` ever sent, the system-transform hook
  output is byte-identical to today's.

## 8. Files touched

- New: `src/mode/{types,store,command,prompt}.ts` + tests; `command/mode.md`
  writer (in `src/index.ts` startup or a small `src/mode/install.ts`).
- Modified: `src/index.ts` (construct `DriveModeStore`; add
  `command.execute.before` + `chat.message` hooks; make system-transform
  mode-aware; write the command file on startup), `src/types.ts`
  (`PluginContext.driveModeStore`, and `programRunner` slot for Spec 2).

## 9. Seam contract (frozen for parallel work)

Spec 1 depends on Spec 2 **only** through `ProgramRunner.run(skillName, args,
ctx)` and the `ProgramResult`/`SessionCtx` shapes in §4. Both specs are built
against this signature; integration happens at this seam. Spec 1 ships with a
stub runner so it is testable and mergeable before Spec 2 completes.
