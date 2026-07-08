# Design: Program-led engine (Spec 2 of 2)

Date: 2026-07-08
Status: Draft for review
Companion: `2026-07-08-drive-mode-and-mode-command-design.md` (Spec 1 — drive mode + `/mode`)

## 1. Purpose

Add a **program-led** execution model: a skill ships real executable code (a
`run.ts`) that drives a deterministic procedure, calling the LLM only where it
needs to — "the model as a function." Hera stops chattering and executes the
program; the model is a subroutine, not the driver.

Chosen approach (from brainstorming): **C — executable script + a Hera SDK**,
executed in a **child-process sandbox (C2)** for resilience. Rationale: a
program skill is arbitrary user code; running it in-process would let a hang,
unhandled throw, or memory blowup take down the whole Hera plugin (which is
concurrently serving the live OpenCode session). The subprocess boundary gives
crash/hang isolation and a bounded, kill-on-timeout lifecycle, consistent with
the engine's existing resilience hardening.

## 2. Skill package shape

A `SkillPackage` (dir `hera-data/skills/<name>/`) becomes program-led by adding
one field to `SKILL.json`:

```jsonc
{
  "name": "release-notes",
  "description": "...",
  "program": "run.ts"   // NEW: relative path to the entry script
}
```

The entry exports a default async function:

```ts
// hera-data/skills/release-notes/run.ts
import type { Hera } from "./hera-sdk";        // typed authoring surface (scaffolded)

export default async function run(hera: Hera, args: unknown) {
  const files = await hera.sh("git diff --name-only");         // deterministic
  if (!files.stdout.trim()) return { ok: true, skipped: true };

  const notes = await hera.llm("Write release notes for these files", {
    input: files.stdout,
    schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  });                                                          // model as a function

  await hera.file.write("RELEASE_NOTES.md", notes.title);      // deterministic
  hera.log(`wrote notes: ${notes.title}`);
  return { ok: true, title: notes.title };
}
```

A skill with no `program` field is unchanged (prompt/manifest skill as today).
`SkillPackage`/`SKILL.json` typing in `src/skills/` gains the optional
`program?: string`.

## 3. The Hera SDK (author-facing surface)

The object passed as `hera`. v1 core:

```ts
// shipped as hera-sdk.d.ts (scaffolded into each program skill)
export interface Hera {
  args: unknown;                                     // invocation args
  log(message: string): void;                        // progress -> ProgramResult.logs + heraLog
  sh(cmd: string, opts?: { cwd?: string; timeoutMs?: number })
    : Promise<{ stdout: string; stderr: string; code: number }>;   // runs in the child
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    list(dir: string): Promise<string[]>;
  };                                                 // path-guarded to the session dir; runs in the child
  llm(prompt: string, opts?: {
    input?: unknown;                                 // templated into the prompt
    schema?: object;                                 // JSON Schema -> validated structured return
    executor?: string;                               // which agent runs it (default "hera")
  }): Promise<unknown>;                              // RPC to parent; returns text (string) or validated object
}
```

- `sh` / `file` execute **locally in the child** (it has shell + fs); no RPC —
  the deterministic-heavy path is fast and isolated.
- `llm` requires the OpenCode client (parent-only), so it is **RPC'd to the
  parent** (§4). It is always an autonomous function call in v1 (returns a
  value). Interactive "hand to the human mid-program" (a `collab` sub-step) is
  explicitly **out of scope for v1** — a headless program cannot suspend for a
  turn cleanly; deferred to a follow-up.
- Deliberately **not** in v1 (YAGNI, extensible via the same RPC table):
  `hera.agent(name, prompt)`, `hera.memory.remember/recall`. The RPC dispatch is
  a switch, so adding them later is additive.

## 4. Architecture

New module `src/program/`:

- `src/program/sdk-types.ts` — the `Hera` interface (source of truth) + the
  `hera-sdk.d.ts` scaffold content.
- `src/program/rpc.ts` — the message protocol shared by parent and child:
  `Request { id, method: "llm", params }`, `Response { id, ok, value|error }`,
  plus terminal `Result { done: true, value|error }`. Transport: **Bun IPC**
  (`Bun.spawn({ ipc })` ⇄ child `process.send`/message), matching the
  `--target bun` build. (Fallback transport — newline-JSON over an extra stdio
  fd — noted but not built in v1.)
- `src/program/child-harness.ts` — the code that runs **inside** the child. It:
  1. reads the skill entry path + args from argv/env,
  2. builds the `hera` SDK object (local `sh`/`file`; `llm` → send RPC, await
     reply),
  3. `await import()`s the skill's `run.ts`, calls `default(hera, args)`,
  4. posts a terminal `Result` frame and exits. Any throw becomes
     `Result{ ok:false, error }`. This harness is bundled by the build like the
     engine entry.
- `src/program/runner.ts` — `ProgramRunner` (parent side), implementing the seam
  interface Spec 1 depends on:
  ```ts
  class ProgramRunner {
    run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult>;
  }
  ```
  It: resolves the skill dir + `program` entry via `SkillManager`; spawns the
  child (`Bun.spawn(["bun","run",harness,...], { cwd: ctx.directory, ipc, env })`);
  serves RPC requests (`llm` → §4.1); enforces a total timeout; on
  timeout/cancel kills the child tree; collects the `Result`; returns
  `ProgramResult { ok, value|error, logs }`.
- `src/program/index.ts` — `createProgramRunner(ctx)` factory, wired onto
  `PluginContext.programRunner` in `src/index.ts`.

### 4.1 `llm` RPC handler (parent)

On an `llm` request, the parent:
1. runs the prompt (with `input` templated in) through the engine's
   `AgentRunner` (the same primitive tasks use) under `opts.executor` (default
   `"hera"`);
2. if `schema` is present, enforces/validates structured output (reuse the
   workflow structured-output pattern) and returns the parsed object; else
   returns the assistant text;
3. replies `Response{ ok:true, value }` or `Response{ ok:false, error }` (the
   child rethrows on error so the author sees a normal exception).

### 4.2 Shared shell-exec (targeted refactor)

`hera.sh` needs the same hardened "run a shell command with timeout + Windows
tree-kill" logic I recently hardened in `src/engine/acceptance.ts`. Factor that
into `src/engine/shell-exec.ts` (`runShell(cmd, { cwd, timeoutMs })
: Promise<{ stdout, stderr, code }>`), and have **both** `AcceptanceEvaluator`
and the child harness's `hera.sh` use it. This removes duplication and keeps the
tree-kill fix in one place. Acceptance behavior must remain identical (covered by
existing acceptance tests).

## 5. Invocation paths

Two ways to run a program skill, both landing on `ProgramRunner.run`:

1. **User, via Spec 1**: `/mode program <skill>` → `command.execute.before` →
   `programRunner.run(skill, args, ctx)`.
2. **Model, via a tool**: `hera_run_program({ skill, args })` (new tool in
   `src/tools/`) → same runner. Lets Hera (or another agent) invoke a program
   skill as a step, enabling coarse hybrids (an `auto` loop task that runs a
   program skill; a `collab` session that calls one).

## 6. Authoring / scaffolding

- CLI: `hera create skill <name> --program` and a tool
  `hera_create_program_skill({ name, description })` scaffold the skill dir with:
  `SKILL.json` (incl. `program: "run.ts"`), a `run.ts` template (typed default
  export), and `hera-sdk.d.ts` (the `Hera` interface) for autocomplete.
- Keep the CLI (`bin/hera.js`) and the plugin scaffolding in sync (repo
  convention: both surfaces must agree).

## 7. Error handling & resilience

- Skill missing / no `program` entry → `ProgramResult{ ok:false, error }` (no
  spawn).
- Child throws → harness returns `Result{ ok:false, error }`; runner surfaces it.
- Child hangs / exceeds total timeout → runner kills the child **tree** (reuse
  the hardened tree-kill via `shell-exec` util or a shared `killTree`), returns
  `{ ok:false, error:"program timed out after Nms" }`. The parent event loop is
  never blocked (work is in the child).
- Child exits nonzero without a `Result` frame → `{ ok:false, error }` with
  captured stderr.
- `llm` RPC failure → error propagated into the child as a thrown exception the
  author can catch.
- Path-guard: `hera.file` rejects paths escaping the session directory
  (allowlist = `ctx.directory`), so a program can't scribble arbitrarily via the
  SDK (it can still via `sh` — see trust model).
- Trust model (documented): program skills are **user-authored**; the sandbox is
  for **resilience** (crash/hang/timeout isolation), not full security
  (a script can still touch fs/network within the child). Hard security
  sandboxing (container/seccomp) is a future extension at this same subprocess
  seam.

## 8. Testing

- `src/engine/shell-exec.test.ts` — the extracted `runShell`: stdout/stderr/code
  capture, timeout kills the tree (the case the acceptance fix already exercises);
  acceptance tests continue to pass unchanged.
- `src/program/rpc.test.ts` — request/response/result framing round-trips.
- `src/program/runner.test.ts` (integration, tiny fixtures under a temp dir):
  - deterministic-only skill (`hera.sh "echo"` + `hera.file.write`) →
    `ok:true`, side effects present, logs captured.
  - skill that throws → `ok:false` with the message.
  - skill that hangs → timeout → child killed → `ok:false` timed-out.
  - `llm` step with a mocked parent `AgentRunner` (schema path) → validated
    object returned into the program.
  - missing `program` entry → `ok:false`, no spawn.
- `src/tools/*` — `hera_run_program` routes to the runner and formats the result.

## 9. Files touched

- New: `src/program/{sdk-types,rpc,child-harness,runner,index}.ts` + tests;
  `src/engine/shell-exec.ts` + test; `hera_run_program` tool; scaffolding
  additions.
- Modified: `src/engine/acceptance.ts` (use `shell-exec`), `src/skills/`
  (`SkillPackage.program?`, resolution), `src/tools/index.ts` (register tool),
  `src/index.ts` (wire `programRunner` onto `PluginContext`), `bin/hera.js`
  (`--program` scaffold), build config (bundle `child-harness`), `src/types.ts`
  (`PluginContext.programRunner`, `ProgramResult`, `SessionCtx`).

## 10. Seam contract (frozen for parallel work)

Spec 2 exposes exactly `ProgramRunner.run(skillName, args, ctx): Promise<
ProgramResult>` with `SessionCtx { sessionID, directory }` and `ProgramResult =
{ ok:true, value, logs } | { ok:false, error, logs }`. Spec 1 consumes only
this. The two specs are built in parallel against this signature and integrated
at the seam; Spec 1 uses a stub runner until this lands.
