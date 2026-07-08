# Program-led Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a program-led execution model to Hera where a skill ships a real `run.ts` that drives a deterministic procedure and calls the LLM only as a function, executed inside a kill-on-timeout child-process sandbox.

**Architecture:** A new `src/program/` module runs a skill's `run.ts` inside a `Bun.spawn` child (Approach C + C2 subprocess sandbox). The child gets a `hera` SDK whose `sh`/`file` run **locally** in the child and whose `llm` is **RPC'd** to the parent over Bun IPC; the parent serves `llm` requests through the existing engine `AgentRunner` (plus JSON-schema structured-output validation), enforces a total timeout, and kills the child tree on timeout/cancel. The hardened shell-exec logic currently living inside `AcceptanceEvaluator` is first extracted into a shared `src/engine/shell-exec.ts` used by both acceptance and the child's `hera.sh`.

**Tech Stack:** TypeScript, Bun (`--target bun`), Bun IPC (`Bun.spawn({ ipc })` ⇄ child `process.send`/`process.on("message")`), `bun:test`, `@opencode-ai/plugin` `tool()` registration, Zod (`tool.schema`).

## Global Constraints

Every task's requirements implicitly include this section.

- **Release gate (must pass after every task):** `bun run typecheck && bun run lint && bun run build && bun test`
- **Logging:** use `heraLog()` from `src/logger.ts` — never `console.*`.
- **Atomic writes:** persisted files that must survive interrupted writes use `atomicWriteText()` / `atomicWriteJson()` from `src/helpers.ts`.
- **Constants:** prefer named constants in `src/constants.ts` over hardcoded limits/timeouts/defaults.
- **Tests:** `bun:test`, one `*.test.ts` next to its source; temp dirs via `mkdtemp`/`mkdirSync` under `tmpdir()`; `bunfig.toml` sets `root=src`, coverage floor `lines 0.9 / functions 0.85`, timeout 30000ms.
- **Path safety:** use `isSafeRelativePath()` from `src/validation.ts` (or the session-dir guard defined in this plan) before turning caller input into a path segment.
- **CLI/plugin parity:** keep `bin/hera.js` scaffolding in sync with plugin scaffolding (repo convention: both surfaces must agree).
- **Formatting:** run `bun run format` (Prettier) after edits; the repo also runs `bun run lint` (ESLint).
- **Frozen seam (do NOT change these shapes — Spec 1 consumes them verbatim):**
  ```ts
  interface ProgramRunner { run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult>; }
  interface SessionCtx { sessionID: string; directory: string; }
  type ProgramResult = { ok: true; value: unknown; logs: string[] } | { ok: false; error: string; logs: string[] };
  ```

---

## Cross-plan coordination (read before starting)

This plan and `2026-07-09-drive-mode-and-mode-command.md` (Plan 1) both touch
`src/types.ts` and `src/index.ts`. To avoid a duplicate-definition conflict,
ownership is fixed:

- **Plan 1 owns** the seam types `SessionCtx` / `ProgramResult` / `ProgramRunner`
  and the `PluginContext.programRunner` field in `src/types.ts`, and constructs a
  `StubProgramRunner` on `ctx` in `src/index.ts` (Plan 1 Tasks 1 & 7).
- **This plan consumes** those types by importing them from `../types.js` (never
  redefining them), adds only `SkillPackage.program?` to `src/types.ts`, and in
  `src/index.ts` **replaces** Plan 1's stub with the real `createProgramRunner(...)`.

**Ordering:** Plan 1's Task 1 (seam types, ~5 min) should land first so this
plan's `../types.js` imports resolve; then both plans proceed in parallel. This
plan's `src/index.ts` swap (Task 4 Step 8) slots in after Plan 1's Task 7. Every
other task here (`shell-exec`, `rpc`, `child-harness`, `runner`, skills
persistence, tools, scaffold) is independent of Plan 1.

---

## File Structure

**New files**

| File | Responsibility |
| --- | --- |
| `src/engine/shell-exec.ts` | Shared `runShell(cmd,{cwd,timeoutMs})` + `killTree(pid)` (extracted from `acceptance.ts`); one home for the Windows `taskkill /T /F` tree-kill fix. |
| `src/engine/shell-exec.test.ts` | Unit tests: stdout/stderr/code capture; nonzero exit; timeout sets `timedOut` and kills the tree quickly. |
| `src/program/rpc.ts` | Parent⇄child message framing: `RpcRequest`/`RpcResponse`/`RpcResult`/`RpcLog` types + `isRequest`/`isResponse`/`isResult`/`isLog` guards. Pure, no IO. |
| `src/program/rpc.test.ts` | Round-trip/guard tests for the framing types. |
| `src/program/sdk-types.ts` | The `Hera` author-facing interface (source of truth) + scaffold string constants (`HERA_SDK_DTS`, `RUN_TS_TEMPLATE`, `SKILL_JSON_TEMPLATE`). |
| `src/program/child-harness.ts` | Runs **inside** the child: `createHeraSdk()` (local `sh`/`file`, RPC `llm`, `log`) + `main()` bootstrap that imports the skill's entry and posts a terminal `Result`. Bundled by the build. |
| `src/program/child-harness.test.ts` | Unit tests for `createHeraSdk` against a fake channel (sh/file/log/llm, path-guard). |
| `src/program/runner.ts` | `class ProgramRunner implements ProgramRunner` (parent): resolves skill+`program`, spawns child, serves `llm` RPC via `AgentRunner`+schema validation, enforces total timeout, kills tree, collects `Result` → `ProgramResult`. |
| `src/program/runner.test.ts` | Integration tests with tiny fixture skills in a temp dir (deterministic ok:true; throw→ok:false; hang→timeout→ok:false; llm step with mocked `AgentRunner`; missing program→no spawn). |
| `src/program/index.ts` | `createProgramRunner(opts)` factory wiring an `OpenCodeAgentRunner` into `ProgramRunner`. |
| `src/tools/program-tools.ts` | `hera_run_program({ skill, args })` tool → `ctx.programRunner.run()`. |
| `src/tools/program-tools.test.ts` | Tool routing/formatting tests against a stub runner. |

**Modified files**

| File | Change |
| --- | --- |
| `src/engine/acceptance.ts` | Delete inline shell promise + `killTree` + `KILL_TREE_WAIT_MS`; import and use `runShell`/`killTree` from `shell-exec.ts`. Behavior identical. |
| `src/types.ts` | Add `SessionCtx`, `ProgramResult`, `ProgramRunner` interface; add `program?: string` to `SkillPackage`; add `programRunner: ProgramRunner` to `PluginContext`. |
| `src/constants.ts` | Add `PROGRAM_TOTAL_TIMEOUT_MS`. |
| `src/skills/manager.ts` | Persist `program` in `SKILL.json` (`writePackageToDisk`) and read it back (`readPackageFromDisk`). |
| `src/skills/manager.test.ts` | Add a `program` round-trip test. |
| `src/tools/index.ts` | Register `createProgramTools(ctx)` in the merged tool map. |
| `src/index.ts` | Build `createProgramRunner(...)` and put it on `PluginContext.programRunner`. |
| `bin/hera.js` | Add `hera create skill <name> --program` scaffold; keep in sync with the plugin scaffold. |
| `package.json` | Add a third `bun build` for `src/program/child-harness.ts` → `dist/program/`; add `dist/program/child-harness.js` to `files`. |

---

## Task 1: Extract shared `shell-exec` and switch `acceptance.ts` to it

Moves the hardened "run a shell command with timeout + Windows tree-kill" logic out of `AcceptanceEvaluator` into a reusable `runShell`/`killTree`, WITHOUT changing acceptance behavior. This must land first and stay green so later tasks (and the child harness) reuse one tree-kill implementation.

**Files:**
- Create: `src/engine/shell-exec.ts`
- Create: `src/engine/shell-exec.test.ts`
- Modify: `src/engine/acceptance.ts`
- Existing (must still pass unchanged): `src/engine/acceptance.test.ts`

**Interfaces:**
- Consumes: `node:child_process` `exec`/`execFile`.
- Produces:
  - `export interface ShellResult { stdout: string; stderr: string; code: number; timedOut: boolean; }`
  - `export function runShell(cmd: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ShellResult>` — on timeout resolves `{ timedOut: true, code: -1 }` after the tree-kill (bounded by `KILL_TREE_WAIT_MS`); otherwise `{ timedOut: false, code: <exit code> }`.
  - `export function killTree(pid: number): Promise<void>` — Windows `taskkill /pid <pid> /T /F`; POSIX `process.kill(pid, "SIGKILL")`. Resolves once the kill is issued (and, on Windows, `taskkill` exited).

- [ ] **Step 1: Write the failing test**

Create `src/engine/shell-exec.test.ts`:

```ts
// src/engine/shell-exec.test.ts
import { describe, it, expect } from "bun:test";
import { runShell, killTree } from "./shell-exec.js";

describe("runShell", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runShell("echo hera-out");
    expect(r.code).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toContain("hera-out");
  });

  it("reports a nonzero exit code", async () => {
    const r = await runShell("exit 3");
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(3);
  });

  it("times out, sets timedOut, and returns promptly (tree-kill)", async () => {
    // Windows: `sleep` is not a cmd.exe builtin; use ping to block reliably.
    const slow = process.platform === "win32" ? "ping -n 6 127.0.0.1 >NUL" : "sleep 5";
    const start = Date.now();
    const r = await runShell(slow, { timeoutMs: 50 });
    expect(r.timedOut).toBe(true);
    // Resolves after the tree-kill completes, well under the 5s command.
    expect(Date.now() - start).toBeLessThan(4000);
  });

  it("killTree tolerates a nonexistent pid", async () => {
    await expect(killTree(2 ** 30)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/engine/shell-exec.test.ts`
Expected: FAIL — `Cannot find module './shell-exec.js'` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/engine/shell-exec.ts`:

```ts
// src/engine/shell-exec.ts
import { exec, execFile } from "node:child_process";

/**
 * Upper bound on how long a timed-out shell command waits for the process-tree
 * kill to complete before resolving anyway. Keeps a wedged taskkill from
 * stalling the caller.
 */
export const KILL_TREE_WAIT_MS = 2000;

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

/**
 * Best-effort kill of a child process (and, on Windows, its tree). Resolves once
 * the kill has been issued and — on Windows — taskkill has exited, i.e. the tree
 * is actually gone and its file handles are released.
 */
export function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    // taskkill /T terminates the process tree (e.g. cmd.exe + its `ping` child);
    // /F forces it.
    return new Promise((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => resolve());
    });
  }
  // Direct SIGKILL of the spawned `sh -c ...` child. We intentionally do NOT
  // spawn detached / kill a negative process group: under Bun a detached child
  // can keep the runtime from exiting cleanly.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already exited */
  }
  return Promise.resolve();
}

/**
 * Run a shell command with captured output and a manual timeout + process-tree
 * kill. Node's built-in exec `timeout` only signals the top-level shell; on
 * Windows `cmd.exe /c` does not propagate the kill to its children, leaking the
 * grandchild (e.g. a blocking `ping`) which keeps holding `cwd`. On timeout we
 * kill the whole tree, wait (bounded) for the kill to complete, then resolve.
 */
export function runShell(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? 0;
  return new Promise<ShellResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    };

    const child = exec(cmd, { cwd: opts.cwd, windowsHide: true }, (err) => {
      // The timeout branch owns the resolve; a post-kill callback here (which may
      // never arrive under Bun after SIGKILL) must not overwrite it.
      if (timedOut) return;
      const c = (err as { code?: number } | null)?.code;
      if (err && typeof c === "number") return finish(c);
      if (err) return finish(-1);
      finish(0);
    });

    // Accumulate incrementally so a timed-out command still yields partial output.
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        // Kill the tree, then a direct fallback SIGKILL AFTER the tree kill: on
        // Windows, killing cmd.exe before taskkill snapshots its children orphans
        // them (a blocking `ping` keeps holding cwd → EBUSY on cleanup).
        const treeKilled = (child.pid ? killTree(child.pid) : Promise.resolve()).then(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        });
        const cap = setTimeout(() => finish(-1), KILL_TREE_WAIT_MS);
        void treeKilled.then(() => {
          clearTimeout(cap);
          finish(-1);
        });
      }, timeoutMs);
    }

    child.on("error", () => finish(-1));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/engine/shell-exec.test.ts`
Expected: PASS — `4 pass, 0 fail`.

- [ ] **Step 5: Switch `acceptance.ts` to the shared helper (no behavior change)**

In `src/engine/acceptance.ts`:

1. Replace the top import block that pulls in `exec, execFile`:

```ts
// BEFORE
import { exec, execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { AcceptanceCheck, AcceptanceResult } from "./task-types.js";
```

```ts
// AFTER
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { runShell } from "./shell-exec.js";
import type { AcceptanceCheck, AcceptanceResult } from "./task-types.js";
```

2. Delete the `KILL_TREE_WAIT_MS` constant + its doc comment (now owned by `shell-exec.ts`).

3. Replace the entire `private async shell(...)` method body with the delegating version:

```ts
  private async shell(
    check: Extract<AcceptanceCheck, { type: "shell" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    if (!this.shellEnabled) return this.result(check, false, now, "shell checks disabled");
    const expectExit = check.expectExit ?? 0;
    const timeout = check.timeoutMs ?? this.defaultTimeoutMs;
    const res = await runShell(check.command, { cwd: check.cwd ?? ctx.cwd, timeoutMs: timeout });
    if (res.timedOut) return this.result(check, false, now, "timeout");
    return this.result(check, res.code === expectExit, now, `exit ${res.code}`);
  }
```

4. Delete the entire `private killTree(pid: number): Promise<void> { ... }` method from `acceptance.ts` (it now lives in `shell-exec.ts`).

- [ ] **Step 6: Run BOTH test files to prove behavior is unchanged**

Run: `bun test src/engine/acceptance.test.ts src/engine/shell-exec.test.ts`
Expected: PASS — acceptance's 18 tests still green (including "fails a shell check on timeout" → detail contains `timeout`, "passes a shell check on exit 0", "fails a shell check on nonzero exit" → detail contains `3`), plus shell-exec's 4 tests. `0 fail`.

- [ ] **Step 7: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: no type errors, no lint errors, Prettier writes/leaves files formatted.

- [ ] **Step 8: Commit**

```bash
git add src/engine/shell-exec.ts src/engine/shell-exec.test.ts src/engine/acceptance.ts
git commit -m "$(cat <<'EOF'
refactor(engine): extract shared shell-exec from acceptance

Move the timeout + Windows tree-kill shell runner out of AcceptanceEvaluator
into src/engine/shell-exec.ts (runShell + killTree) so the child program
harness can reuse the exact same hardened logic. Acceptance behavior is
unchanged; existing acceptance tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: RPC framing types and guards (`src/program/rpc.ts`)

The message protocol shared by parent and child. Pure types + discriminators, unit-testable with no IO. Transport is Bun IPC (structured-clone objects), so frames are plain objects — no manual (de)serialization is needed; the guards let each side discriminate incoming frames.

**Files:**
- Create: `src/program/rpc.ts`
- Create: `src/program/rpc.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3 & 4):
  - `interface LlmParams { prompt: string; input?: unknown; schema?: object; executor?: string; }`
  - `interface RpcRequest { kind: "request"; id: number; method: "llm"; params: LlmParams; }`
  - `interface RpcResponse { kind: "response"; id: number; ok: boolean; value?: unknown; error?: string; }`
  - `interface RpcLog { kind: "log"; message: string; }`
  - `interface RpcResult { kind: "result"; ok: boolean; value?: unknown; error?: string; }`
  - `type ChildToParent = RpcRequest | RpcResult | RpcLog;` (frames the child sends up)
  - `type ParentToChild = RpcResponse;` (frames the parent sends down)
  - Guards: `isRequest`, `isResponse`, `isResult`, `isLog`.

- [ ] **Step 1: Write the failing test**

Create `src/program/rpc.test.ts`:

```ts
// src/program/rpc.test.ts
import { describe, it, expect } from "bun:test";
import {
  isRequest,
  isResponse,
  isResult,
  isLog,
  type RpcRequest,
  type RpcResponse,
  type RpcResult,
  type RpcLog,
} from "./rpc.js";

describe("rpc framing", () => {
  it("discriminates a request frame", () => {
    const req: RpcRequest = { kind: "request", id: 1, method: "llm", params: { prompt: "hi" } };
    expect(isRequest(req)).toBe(true);
    expect(isResponse(req)).toBe(false);
    expect(isResult(req)).toBe(false);
    expect(isLog(req)).toBe(false);
  });

  it("discriminates a response frame", () => {
    const res: RpcResponse = { kind: "response", id: 1, ok: true, value: { title: "x" } };
    expect(isResponse(res)).toBe(true);
    expect(isRequest(res)).toBe(false);
  });

  it("discriminates a result frame", () => {
    const done: RpcResult = { kind: "result", ok: false, error: "boom" };
    expect(isResult(done)).toBe(true);
    expect(isLog(done)).toBe(false);
  });

  it("discriminates a log frame", () => {
    const log: RpcLog = { kind: "log", message: "progress" };
    expect(isLog(log)).toBe(true);
    expect(isResult(log)).toBe(false);
  });

  it("rejects a non-frame value", () => {
    expect(isRequest(null)).toBe(false);
    expect(isResponse(42)).toBe(false);
    expect(isResult("nope")).toBe(false);
    expect(isLog(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/program/rpc.test.ts`
Expected: FAIL — `Cannot find module './rpc.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/program/rpc.ts`:

```ts
// src/program/rpc.ts
// Message protocol shared by the parent ProgramRunner and the child harness.
// Transport is Bun IPC (structured-clone), so frames are plain objects; these
// guards let each side discriminate incoming frames by their `kind`.

export interface LlmParams {
  prompt: string;
  input?: unknown;
  schema?: object;
  executor?: string;
}

/** Child -> parent: "run this prompt through the LLM and reply". */
export interface RpcRequest {
  kind: "request";
  id: number;
  method: "llm";
  params: LlmParams;
}

/** Parent -> child: the reply to one RpcRequest, keyed by `id`. */
export interface RpcResponse {
  kind: "response";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Child -> parent: a progress log line (accumulated into ProgramResult.logs). */
export interface RpcLog {
  kind: "log";
  message: string;
}

/** Child -> parent: the terminal outcome of the program. */
export interface RpcResult {
  kind: "result";
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type ChildToParent = RpcRequest | RpcResult | RpcLog;
export type ParentToChild = RpcResponse;

function hasKind(v: unknown): v is { kind: string } {
  return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
}

export function isRequest(v: unknown): v is RpcRequest {
  return hasKind(v) && v.kind === "request";
}

export function isResponse(v: unknown): v is RpcResponse {
  return hasKind(v) && v.kind === "response";
}

export function isResult(v: unknown): v is RpcResult {
  return hasKind(v) && v.kind === "result";
}

export function isLog(v: unknown): v is RpcLog {
  return hasKind(v) && v.kind === "log";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/program/rpc.test.ts`
Expected: PASS — `5 pass, 0 fail`.

- [ ] **Step 5: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/program/rpc.ts src/program/rpc.test.ts
git commit -m "$(cat <<'EOF'
feat(program): add parent<->child RPC framing types and guards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Hera SDK types + child harness (`sdk-types.ts`, `child-harness.ts`)

Defines the author-facing `Hera` interface (source of truth) and the code that runs **inside** the child: `createHeraSdk()` (local `sh`/`file`, RPC `llm`, `log`) plus a `main()` bootstrap that imports the skill entry, calls `default(hera, args)`, and posts a terminal `Result`. `sh`/`file` run locally in the child; `llm` is RPC'd to the parent.

**Files:**
- Create: `src/program/sdk-types.ts`
- Create: `src/program/child-harness.ts`
- Create: `src/program/child-harness.test.ts`

**Interfaces:**
- Consumes: `runShell` from `src/engine/shell-exec.ts`; `ChildToParent`, `RpcResponse` from `src/program/rpc.ts`.
- Produces:
  - `src/program/sdk-types.ts`: `export interface Hera { ... }` (verbatim below) + `export const HERA_SDK_DTS: string`, `export const RUN_TS_TEMPLATE: string`, `export const SKILL_JSON_TEMPLATE: (name: string, description: string) => string` (consumed by Task 7 scaffolding).
  - `src/program/child-harness.ts`:
    - `export interface HarnessChannel { send(message: ChildToParent): void; onResponse(handler: (res: RpcResponse) => void): void; }`
    - `export function createHeraSdk(opts: { args: unknown; sessionDir: string; channel: HarnessChannel }): Hera`
    - `export async function main(): Promise<void>` (bootstrap; runs only when `import.meta.main`).

- [ ] **Step 1: Write the failing test**

Create `src/program/child-harness.test.ts`:

```ts
// src/program/child-harness.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeraSdk, type HarnessChannel } from "./child-harness.js";
import type { ChildToParent, RpcResponse } from "./rpc.js";

function makeChannel() {
  const sent: ChildToParent[] = [];
  let handler: ((res: RpcResponse) => void) | undefined;
  const channel: HarnessChannel = {
    send: (m) => sent.push(m),
    onResponse: (h) => {
      handler = h;
    },
  };
  return { channel, sent, respond: (res: RpcResponse) => handler?.(res) };
}

describe("createHeraSdk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "harness-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("exposes invocation args", () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: { a: 1 }, sessionDir: dir, channel });
    expect(hera.args).toEqual({ a: 1 });
  });

  it("runs sh locally and returns stdout/code", async () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    const r = await hera.sh("echo harness-ok");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("harness-ok");
  });

  it("writes, reads, checks existence, and lists files in the session dir", async () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    await hera.file.write("sub/data.txt", "hello");
    expect(await hera.file.exists("sub/data.txt")).toBe(true);
    expect(await hera.file.read("sub/data.txt")).toBe("hello");
    expect(await hera.file.list("sub")).toContain("data.txt");
  });

  it("path-guards file access outside the session dir", async () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    await expect(hera.file.write("../escape.txt", "x")).rejects.toThrow(/escapes/);
  });

  it("log() sends a log frame", () => {
    const { channel, sent } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    hera.log("progress");
    expect(sent).toContainEqual({ kind: "log", message: "progress" });
  });

  it("llm() sends a request and resolves on the matching response", async () => {
    const { channel, sent, respond } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    const p = hera.llm("write notes", { schema: { type: "object" } });
    const req = sent.find((m) => m.kind === "request");
    expect(req).toBeDefined();
    respond({ kind: "response", id: (req as { id: number }).id, ok: true, value: { title: "T" } });
    expect(await p).toEqual({ title: "T" });
  });

  it("llm() rejects when the response is ok:false", async () => {
    const { channel, sent, respond } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    const p = hera.llm("x");
    const req = sent.find((m) => m.kind === "request");
    respond({ kind: "response", id: (req as { id: number }).id, ok: false, error: "llm failed" });
    await expect(p).rejects.toThrow("llm failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/program/child-harness.test.ts`
Expected: FAIL — `Cannot find module './child-harness.js'`.

- [ ] **Step 3: Write `sdk-types.ts`**

Create `src/program/sdk-types.ts`:

```ts
// src/program/sdk-types.ts
// The author-facing surface for program-led skills. This interface is the source
// of truth; HERA_SDK_DTS below is the .d.ts scaffolded into each program skill.

export interface Hera {
  /** Invocation args passed to run(hera, args). */
  args: unknown;
  /** Progress line -> ProgramResult.logs + heraLog on the parent. */
  log(message: string): void;
  /** Runs locally in the child (has shell + fs). No RPC. */
  sh(
    cmd: string,
    opts?: { cwd?: string; timeoutMs?: number }
  ): Promise<{ stdout: string; stderr: string; code: number }>;
  /** Path-guarded to the session directory; runs locally in the child. */
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    list(dir: string): Promise<string[]>;
  };
  /**
   * The model as a function. RPC'd to the parent: returns assistant text, or a
   * validated object when `schema` is supplied. Always an autonomous call in v1.
   */
  llm(
    prompt: string,
    opts?: { input?: unknown; schema?: object; executor?: string }
  ): Promise<unknown>;
}

/** Contents of the scaffolded hera-sdk.d.ts (authoring autocomplete). */
export const HERA_SDK_DTS = `// Auto-generated by Hera. The authoring surface for this program skill.
export interface Hera {
  args: unknown;
  log(message: string): void;
  sh(cmd: string, opts?: { cwd?: string; timeoutMs?: number })
    : Promise<{ stdout: string; stderr: string; code: number }>;
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    list(dir: string): Promise<string[]>;
  };
  llm(prompt: string, opts?: { input?: unknown; schema?: object; executor?: string }): Promise<unknown>;
}
`;

/** Contents of the scaffolded run.ts entry template. */
export const RUN_TS_TEMPLATE = `import type { Hera } from "./hera-sdk";

export default async function run(hera: Hera, args: unknown) {
  hera.log("program started");
  // Deterministic step:
  const status = await hera.sh("git status --short");
  // Model as a function (uncomment to use):
  // const summary = await hera.llm("Summarize these changes", {
  //   input: status.stdout,
  //   schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  // });
  return { ok: true, changed: status.stdout.trim().length > 0 };
}
`;

/** Contents of the scaffolded SKILL.json for a program skill. */
export const SKILL_JSON_TEMPLATE = (name: string, description: string): string =>
  JSON.stringify({ name, description, trigger: "", category: "user", program: "run.ts" }, null, 2) +
  "\n";
```

- [ ] **Step 4: Write `child-harness.ts`**

Create `src/program/child-harness.ts`:

```ts
// src/program/child-harness.ts
// Runs INSIDE the child process. Builds the `hera` SDK (local sh/file, RPC llm),
// imports the skill's entry, calls default(hera, args), and posts a terminal
// Result. Bundled by the build (dist/program/child-harness.js).
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runShell } from "../engine/shell-exec.js";
import type { ChildToParent, RpcResponse } from "./rpc.js";
import type { Hera } from "./sdk-types.js";

export interface HarnessChannel {
  send(message: ChildToParent): void;
  onResponse(handler: (res: RpcResponse) => void): void;
}

/** Reject any path that resolves outside the session directory. */
function resolveInDir(sessionDir: string, p: string): string {
  const resolved = isAbsolute(p) ? p : resolve(sessionDir, p);
  const rel = relative(sessionDir, resolved);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`path escapes session directory: ${p}`);
  }
  return resolved;
}

export function createHeraSdk(opts: {
  args: unknown;
  sessionDir: string;
  channel: HarnessChannel;
}): Hera {
  const { args, sessionDir, channel } = opts;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  channel.onResponse((res) => {
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new Error(res.error ?? "llm request failed"));
  });
  let nextId = 1;

  return {
    args,
    log(message: string) {
      channel.send({ kind: "log", message });
    },
    async sh(cmd, o) {
      const r = await runShell(cmd, { cwd: o?.cwd ?? sessionDir, timeoutMs: o?.timeoutMs });
      return { stdout: r.stdout, stderr: r.stderr, code: r.code };
    },
    file: {
      read: (p) => readFile(resolveInDir(sessionDir, p), "utf-8"),
      write: async (p, content) => {
        const abs = resolveInDir(sessionDir, p);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf-8");
      },
      exists: async (p) => {
        try {
          await access(resolveInDir(sessionDir, p));
          return true;
        } catch {
          return false;
        }
      },
      list: (p) => readdir(resolveInDir(sessionDir, p)),
    },
    llm(prompt, o) {
      const id = nextId++;
      return new Promise<unknown>((resolveLlm, rejectLlm) => {
        pending.set(id, { resolve: resolveLlm, reject: rejectLlm });
        channel.send({
          kind: "request",
          id,
          method: "llm",
          params: { prompt, input: o?.input, schema: o?.schema, executor: o?.executor },
        });
      });
    },
  };
}

function parseArgs(raw: string | undefined): unknown {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

/** Child bootstrap. Reads entry+args from env, runs the program, posts Result. */
export async function main(): Promise<void> {
  const channel: HarnessChannel = {
    send: (m) => process.send?.(m),
    onResponse: (h) => process.on("message", (msg) => h(msg as RpcResponse)),
  };
  const entry = process.env.HERA_PROGRAM_ENTRY;
  const sessionDir = process.cwd();
  const args = parseArgs(process.env.HERA_PROGRAM_ARGS);

  if (!entry) {
    channel.send({ kind: "result", ok: false, error: "no program entry provided" });
    return;
  }

  const hera = createHeraSdk({ args, sessionDir, channel });
  try {
    const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
    const run = mod.default;
    if (typeof run !== "function") {
      throw new Error("program entry has no default export function");
    }
    const value = await (run as (h: Hera, a: unknown) => unknown)(hera, args);
    channel.send({ kind: "result", ok: true, value });
  } catch (err) {
    channel.send({ kind: "result", ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  // Intentionally do NOT disconnect/exit here: keep the IPC channel open so the
  // Result frame is delivered in order, and let the parent tear the child down
  // once it receives the Result (or on timeout).
}

// Bun sets import.meta.main only when this file is the process entry, so
// importing it from tests does not trigger the bootstrap.
if (import.meta.main) {
  void main();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/program/child-harness.test.ts`
Expected: PASS — `7 pass, 0 fail`.

- [ ] **Step 6: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/program/sdk-types.ts src/program/child-harness.ts src/program/child-harness.test.ts
git commit -m "$(cat <<'EOF'
feat(program): add Hera SDK types and in-child harness

createHeraSdk builds the author-facing `hera` object: sh/file run locally in
the child (reusing runShell), llm is RPC'd to the parent, log streams progress.
main() imports the skill entry, calls default(hera, args), and posts a terminal
Result frame.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Parent-side `ProgramRunner` + seam types + wiring (`runner.ts`, `index.ts`)

The parent side that implements the frozen `ProgramRunner` seam: resolve the skill+`program`, spawn the child (`Bun.spawn` with `ipc`), serve `llm` RPC through the engine `AgentRunner` (with schema validation), enforce a total timeout, kill the child tree on timeout/cancel/result, and collect the terminal `Result` into a `ProgramResult`.

**Files:**
- Modify: `src/types.ts` (add ONLY `SkillPackage.program?`; the seam types + `PluginContext.programRunner` are owned by Plan 1 — import, do not redefine — see Cross-plan coordination)
- Modify: `src/constants.ts` (add `PROGRAM_TOTAL_TIMEOUT_MS`)
- Create: `src/program/runner.ts`
- Create: `src/program/index.ts`
- Create: `src/program/runner.test.ts`
- Modify: `src/index.ts` (wire `programRunner` onto `PluginContext`)

**Interfaces:**
- Consumes: `AgentRunner` from `src/engine/executor.ts` (`run(executor: string, prompt: string, signal?: AbortSignal): Promise<string>`); `killTree` from `src/engine/shell-exec.ts`; `ChildToParent`, `RpcRequest`, `RpcResponse`, `RpcResult` from `src/program/rpc.ts`; `SkillManager.getSkillPackage(name): SkillPackage | undefined`; `OpenCodeAgentRunner` from `src/engine/opencode-agent-runner.ts`.
- Produces:
  - `src/types.ts`: `SessionCtx`, `ProgramResult`, `ProgramRunner` (interface), `SkillPackage.program?: string`, `PluginContext.programRunner: ProgramRunner`.
  - `src/program/runner.ts`: `export class ProgramRunner implements ProgramRunnerContract` with constructor `{ skillManager: Pick<SkillManager, "getSkillPackage">; skillsDir: string; runner: AgentRunner; harnessPath?: string; timeoutMs?: number }`.
  - `src/program/index.ts`: `export function createProgramRunner(opts: { client: OpenCodeClient | undefined; skillManager: SkillManager; skillsDir: string; directory: string; timeoutMs?: number }): ProgramRunner`.

- [ ] **Step 1: Add `SkillPackage.program?` to `src/types.ts`**

> **Do NOT redefine the seam types here.** `SessionCtx` / `ProgramResult` /
> `ProgramRunner` and `PluginContext.programRunner` are owned by Plan 1 (see
> Cross-plan coordination). This plan imports them from `../types.js`
> (`runner.ts`, `index.ts`, `program-tools.ts` already do). A second definition
> in `src/types.ts` is a "Duplicate identifier" compile error. This step adds
> ONLY the `SkillPackage.program?` field, which Plan 1 does not touch.

Add `program?: string;` to the `SkillPackage` interface (`src/types.ts:42`),
right after `metadata?: SkillMetadata;`:

```ts
export interface SkillPackage {
  name: string;
  version?: string;
  description: string;
  trigger: string | SkillTrigger;
  category?: "builtin" | "user";
  intensity?: SkillDefinition["intensity"];
  createdAt?: number;
  dependencies?: SkillRef[];
  chains?: SkillChain[];
  files?: SkillFile[];
  config?: Record<string, unknown>;
  scripts?: SkillScript[];
  prompt: string;
  metadata?: SkillMetadata;
  /** Relative path to a program entry (run.ts). Present => program-led skill. */
  program?: string;
}
```

> Executing this plan BEFORE Plan 1's Task 1 has landed? Then temporarily add the
> three seam types from Plan 1 Task 1 Step 2 here so the `../types.js` imports
> resolve, and when Plan 1 merges, drop your copy in favor of Plan 1's. Never
> keep two definitions.

- [ ] **Step 2: Add the timeout constant to `src/constants.ts`**

Append under a new `// === Program Engine Configuration ===` heading at the end:

```ts
// === Program Engine Configuration ===

/** Total wall-clock budget for one program run before its child tree is killed. */
export const PROGRAM_TOTAL_TIMEOUT_MS = 300000;
```

- [ ] **Step 3: Write the failing test**

Create `src/program/runner.test.ts`:

```ts
// src/program/runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramRunner } from "./runner.js";
import type { AgentRunner } from "../engine/executor.js";
import type { SkillPackage } from "../types.js";

// Run the real harness from source (bun test runs from src/).
const HARNESS = join(import.meta.dir, "child-harness.ts");
const NOOP_RUNNER: AgentRunner = { run: async () => "" };

function skillManagerWith(program: string | undefined) {
  const pkg: SkillPackage | undefined = program
    ? { name: "fix", description: "", trigger: "", prompt: "", program, config: {}, files: [] }
    : undefined;
  return { getSkillPackage: () => pkg };
}

async function writeSkill(skillsDir: string, name: string, body: string) {
  await mkdir(join(skillsDir, name), { recursive: true });
  await writeFile(join(skillsDir, name, "run.ts"), body, "utf-8");
}

describe("ProgramRunner", () => {
  let root: string;
  let skillsDir: string;
  let workDir: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "prog-"));
    skillsDir = join(root, "skills");
    workDir = join(root, "work");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("runs a deterministic program to ok:true with side effects and logs", async () => {
    await writeSkill(
      skillsDir,
      "fix",
      `export default async function run(hera) {
         await hera.sh("echo hi");
         await hera.file.write("out.txt", "hello");
         hera.log("did work");
         return { done: true };
       }`
    );
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", { x: 1 }, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ done: true });
    expect(res.logs).toContain("did work");
    expect(await readFile(join(workDir, "out.txt"), "utf-8")).toBe("hello");
  });

  it("returns ok:false with the thrown message", async () => {
    await writeSkill(skillsDir, "fix", `export default async function run() { throw new Error("boom"); }`);
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("boom");
  });

  it("kills a hanging program on timeout and returns ok:false", async () => {
    await writeSkill(skillsDir, "fix", `export default async function run() { await new Promise(() => {}); }`);
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
      timeoutMs: 400,
    });
    const start = Date.now();
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("timed out");
    expect(Date.now() - start).toBeLessThan(8000);
  });

  it("serves an llm step with a schema and returns the validated object", async () => {
    await writeSkill(
      skillsDir,
      "fix",
      `export default async function run(hera) {
         const notes = await hera.llm("Write release notes", {
           schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
         });
         await hera.file.write("notes.json", JSON.stringify(notes));
         return notes;
       }`
    );
    const mockRunner: AgentRunner = { run: async () => 'Sure: {"title":"Release 1.0"} done' };
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: mockRunner,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ title: "Release 1.0" });
    expect(await readFile(join(workDir, "notes.json"), "utf-8")).toBe('{"title":"Release 1.0"}');
  });

  it("returns ok:false without spawning when the skill has no program", async () => {
    const runner = new ProgramRunner({
      skillManager: skillManagerWith(undefined),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not a program skill");
  });

  it("returns ok:false when the program entry file is missing", async () => {
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir, // no fix/run.ts written
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not found");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test src/program/runner.test.ts`
Expected: FAIL — `Cannot find module './runner.js'`.

- [ ] **Step 5: Write `runner.ts`**

Create `src/program/runner.ts`:

```ts
// src/program/runner.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { heraLog } from "../logger.js";
import { killTree } from "../engine/shell-exec.js";
import { PROGRAM_TOTAL_TIMEOUT_MS } from "../constants.js";
import type { AgentRunner } from "../engine/executor.js";
import type { SkillManager } from "../skills/manager.js";
import type {
  ProgramResult,
  ProgramRunner as ProgramRunnerContract,
  SessionCtx,
} from "../types.js";
import { isLog, isRequest, isResult, type ChildToParent, type RpcRequest, type RpcResult } from "./rpc.js";

export interface ProgramRunnerDeps {
  skillManager: Pick<SkillManager, "getSkillPackage">;
  skillsDir: string;
  runner: AgentRunner;
  /** Path to the child harness. Defaults to the sibling/dist bundle. */
  harnessPath?: string;
  timeoutMs?: number;
}

/** Resolve the child harness: sibling .ts in source/tests, bundled .js in dist. */
function defaultHarnessPath(): string {
  const tsSibling = join(import.meta.dir, "child-harness.ts");
  if (existsSync(tsSibling)) return tsSibling;
  // Bundled: runner.ts is inlined into dist/index.js, so import.meta.dir is dist.
  return join(import.meta.dir, "program", "child-harness.js");
}

/** Templated prompt: prompt plus an optional Input block, matching task prompts. */
function buildLlmPrompt(prompt: string, input: unknown): string {
  if (input == null) return prompt;
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return `${prompt}\n\nInput:\n${text}`;
}

/**
 * Minimal structured-output enforcement: extract the JSON object from the reply,
 * parse it, and check top-level required keys. Mirrors the tolerant brace
 * extraction the acceptance judge uses; throws so the child rethrows to the author.
 */
function parseStructured(text: string, schema: Record<string, unknown>): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("llm did not return a JSON object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("llm returned invalid JSON");
  }
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const obj = parsed as Record<string, unknown>;
  for (const key of required) {
    if (!(key in obj)) throw new Error(`llm output missing required field: ${key}`);
  }
  return parsed;
}

function toProgramResult(result: RpcResult, logs: string[]): ProgramResult {
  if (result.ok) return { ok: true, value: result.value, logs };
  return { ok: false, error: result.error ?? "program failed", logs };
}

export class ProgramRunner implements ProgramRunnerContract {
  constructor(private deps: ProgramRunnerDeps) {}

  run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult> {
    const logs: string[] = [];
    const pkg = this.deps.skillManager.getSkillPackage(skillName);
    if (!pkg || !pkg.program) {
      return Promise.resolve({ ok: false, error: `skill "${skillName}" is not a program skill`, logs });
    }
    const entry = join(this.deps.skillsDir, skillName, pkg.program);
    if (!existsSync(entry)) {
      return Promise.resolve({ ok: false, error: `program entry not found: ${entry}`, logs });
    }
    const harness = this.deps.harnessPath ?? defaultHarnessPath();
    const timeoutMs = this.deps.timeoutMs ?? PROGRAM_TOTAL_TIMEOUT_MS;

    return new Promise<ProgramResult>((resolve) => {
      let settled = false;
      let result: RpcResult | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (r: ProgramResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        // Tear down the child tree once we have an answer (Result, timeout, or exit).
        void killTree(child.pid).then(() => {
          try {
            child.kill();
          } catch {
            /* already gone */
          }
        });
        resolve(r);
      };

      const child = Bun.spawn(["bun", "run", harness], {
        cwd: ctx.directory,
        env: {
          ...process.env,
          HERA_PROGRAM_ENTRY: entry,
          HERA_PROGRAM_ARGS: JSON.stringify(args ?? null),
          HERA_SESSION_ID: ctx.sessionID,
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        serialization: "advanced",
        ipc: (message: unknown) => {
          const frame = message as ChildToParent;
          if (isLog(frame)) {
            logs.push(frame.message);
            heraLog("info", `[program ${skillName}] ${frame.message}`);
            return;
          }
          if (isRequest(frame)) {
            void this.handleLlm(child, frame);
            return;
          }
          if (isResult(frame)) {
            result = frame;
            finish(toProgramResult(frame, logs));
          }
        },
        onExit: (_proc, code) => {
          if (settled) return;
          if (result) {
            finish(toProgramResult(result, logs));
            return;
          }
          void stderr.then((se) =>
            finish({
              ok: false,
              error: `program exited (code ${code}) without result${se.trim() ? `: ${se.trim()}` : ""}`,
              logs,
            })
          );
        },
      });

      const stderr = child.stderr
        ? new Response(child.stderr as ReadableStream).text()
        : Promise.resolve("");

      timer = setTimeout(
        () => finish({ ok: false, error: `program timed out after ${timeoutMs}ms`, logs }),
        timeoutMs
      );
    });
  }

  private async handleLlm(child: Bun.Subprocess, req: RpcRequest): Promise<void> {
    try {
      const prompt = buildLlmPrompt(req.params.prompt, req.params.input);
      const text = await this.deps.runner.run(req.params.executor ?? "hera", prompt);
      const value = req.params.schema
        ? parseStructured(text, req.params.schema as Record<string, unknown>)
        : text;
      child.send({ kind: "response", id: req.id, ok: true, value });
    } catch (err) {
      child.send({
        kind: "response",
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/program/runner.test.ts`
Expected: PASS — `6 pass, 0 fail`. (Each test spawns a real `bun` child running the harness; the hang test resolves in well under 8s.)

- [ ] **Step 7: Write `src/program/index.ts` factory**

Create `src/program/index.ts`:

```ts
// src/program/index.ts
import { OpenCodeAgentRunner } from "../engine/opencode-agent-runner.js";
import { ProgramRunner as ProgramRunnerImpl } from "./runner.js";
import type { OpenCodeClient } from "../types/client.js";
import type { SkillManager } from "../skills/manager.js";
import type { ProgramRunner } from "../types.js";

export { ProgramRunner as ProgramRunnerImpl } from "./runner.js";

/** Build a ProgramRunner backed by an OpenCode-session AgentRunner for `llm`. */
export function createProgramRunner(opts: {
  client: OpenCodeClient | undefined;
  skillManager: SkillManager;
  skillsDir: string;
  directory: string;
  timeoutMs?: number;
}): ProgramRunner {
  const runner = new OpenCodeAgentRunner(opts.client, opts.directory);
  return new ProgramRunnerImpl({
    skillManager: opts.skillManager,
    skillsDir: opts.skillsDir,
    runner,
    timeoutMs: opts.timeoutMs,
  });
}
```

- [ ] **Step 8: Swap Plan 1's stub for the real runner in `src/index.ts`**

Plan 1 (Task 7) already constructs `const programRunner = new StubProgramRunner();`
and puts `programRunner` on the `ctx` object literal. This step only replaces the
stub value — the `ctx.programRunner` field stays exactly as Plan 1 left it.

Add the import (after `import { createAllTools } from "./tools/index.js";`):

```ts
import { createProgramRunner } from "./program/index.js";
```

Replace Plan 1's stub construction line:

```ts
  // BEFORE (from Plan 1 Task 7 Step 3):
  const programRunner = new StubProgramRunner();
```

with the real runner (`skillsDir` comes from `paths`; `client`/`skillManager`/
`directory` are already in scope where Plan 1 built the stub):

```ts
  // AFTER:
  const programRunner = createProgramRunner({
    client,
    skillManager,
    skillsDir: paths.skillsDir,
    directory,
  });
```

Then delete the now-unused `import { StubProgramRunner } from "./mode/route.js";`
that Plan 1 added (leaving it triggers `no-unused-vars`). The `ctx` literal
already contains `programRunner`, so it needs no change.

> If Plan 1 has NOT landed yet: also add `programRunner: ProgramRunner` to
> `PluginContext` (per Plan 1 Task 7 Step 1) and `programRunner,` to the `ctx`
> literal, and skip the StubProgramRunner deletion.

- [ ] **Step 9: Typecheck, lint, format, and run the full engine+program suites**

Run: `bun run typecheck && bun run lint && bun run format && bun test src/program src/engine`
Expected: no type/lint errors; all `src/program/*` and `src/engine/*` tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/constants.ts src/program/runner.ts src/program/runner.test.ts src/program/index.ts src/index.ts
git commit -m "$(cat <<'EOF'
feat(program): add parent ProgramRunner, seam types, and plugin wiring

ProgramRunner spawns the skill's run.ts in a Bun child, serves llm requests
through the engine AgentRunner with schema validation, enforces a total timeout
that kills the child tree, and collects the terminal Result into a ProgramResult.
createProgramRunner is wired onto PluginContext.programRunner.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Persist `SkillPackage.program` in `SkillManager`

The type field landed in Task 4; this task makes `SkillManager` write `program` into `SKILL.json` and read it back, so a program skill on disk round-trips through create/load.

**Files:**
- Modify: `src/skills/manager.ts` (`writePackageToDisk`, `readPackageFromDisk`)
- Modify: `src/skills/manager.test.ts` (add round-trip test)

**Interfaces:**
- Consumes: `SkillPackage.program?: string` (Task 4).
- Produces: `SKILL.json` includes `program` when set; `getSkillPackage(name)?.program` reflects it after reload.

- [ ] **Step 1: Write the failing test**

Append this `describe` block inside the top-level `describe("SkillManager", ...)` in `src/skills/manager.test.ts` (before its closing `});`):

```ts
  describe("program-led skills", () => {
    test("persists and reloads the program entry field", async () => {
      await manager.createSkill({
        name: "release-notes",
        description: "program skill",
        trigger: "",
        prompt: "",
        program: "run.ts",
        files: [{ path: "run.ts", content: "export default async () => ({ ok: true });" }],
        config: {},
      } as SkillPackage);

      // SKILL.json on disk carries the program field.
      const raw = readFileSync(join(SKILLS_DIR, "release-notes", "SKILL.json"), "utf-8");
      expect(JSON.parse(raw).program).toBe("run.ts");

      // A fresh manager over the same dir reloads it.
      const reloaded = new SkillManager(store, SKILLS_DIR);
      await reloaded.init();
      expect(reloaded.getSkillPackage("release-notes")?.program).toBe("run.ts");
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/skills/manager.test.ts -t "persists and reloads the program entry field"`
Expected: FAIL — `expect(JSON.parse(raw).program).toBe("run.ts")` receives `undefined` (writePackageToDisk does not emit `program` yet).

- [ ] **Step 3: Write `program` into `SKILL.json` (`writePackageToDisk`)**

In `src/skills/manager.ts`, update the `metadata` object inside `writePackageToDisk`:

```ts
    // SKILL.json (metadata)
    const metadata = {
      name: pkg.name,
      description: pkg.description,
      trigger: pkg.trigger,
      category: pkg.category,
      intensity: pkg.intensity,
      program: pkg.program,
      createdAt: pkg.createdAt ?? Date.now(),
    };
```

(`JSON.stringify` omits `program` when it is `undefined`, so non-program skills are unchanged.)

- [ ] **Step 4: Read `program` back (`readPackageFromDisk`)**

In the returned object of `readPackageFromDisk`, add the `program` field:

```ts
    return {
      name: (metadata.name as string) ?? name,
      description: (metadata.description as string) ?? "",
      trigger: (metadata.trigger as string | SkillTrigger) ?? "",
      prompt,
      category: (metadata.category as "builtin" | "user") ?? "user",
      intensity: metadata.intensity as SkillPackage["intensity"],
      program: metadata.program as string | undefined,
      config: config ?? {},
      files: extraFiles,
      createdAt: metadata.createdAt as number | undefined,
      dependencies: [],
      chains: [],
      scripts: [],
      metadata: {},
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/skills/manager.test.ts -t "persists and reloads the program entry field"`
Expected: PASS — `1 pass, 0 fail`.

- [ ] **Step 6: Run the full skills suite to catch regressions**

Run: `bun test src/skills/manager.test.ts`
Expected: all existing SkillManager tests still pass, `0 fail`.

- [ ] **Step 7: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/skills/manager.ts src/skills/manager.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): persist and reload SkillPackage.program in SKILL.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `hera_run_program` tool

Lets the model (or another agent) invoke a program skill as a step. Routes `{ skill, args }` to `ctx.programRunner.run(...)` with a `SessionCtx` built from the tool's execution context, then formats the `ProgramResult`.

**Files:**
- Create: `src/tools/program-tools.ts`
- Create: `src/tools/program-tools.test.ts`
- Modify: `src/tools/index.ts` (register the tool group)

**Interfaces:**
- Consumes: `PluginContext.programRunner` (Task 4); `tool()` + `tool.schema` from `@opencode-ai/plugin`; `ToolContext` (`{ sessionID: string; directory: string; worktree: string }`) passed as the 2nd arg of `execute`.
- Produces: `export function createProgramTools(ctx: PluginContext): { hera_run_program: ToolDefinition }`.

- [ ] **Step 1: Write the failing test**

Create `src/tools/program-tools.test.ts`:

```ts
// src/tools/program-tools.test.ts
import { describe, it, expect } from "bun:test";
import { createProgramTools } from "./program-tools.js";
import type { PluginContext, ProgramResult } from "../types.js";

function ctxWithRunner(result: ProgramResult): PluginContext {
  return {
    programRunner: {
      run: async () => result,
    },
  } as unknown as PluginContext;
}

const TOOL_CTX = { sessionID: "s1", directory: "/work", worktree: "/work" };

describe("hera_run_program", () => {
  it("routes a successful run and formats value + logs", async () => {
    const tools = createProgramTools(ctxWithRunner({ ok: true, value: { title: "T" }, logs: ["l1"] }));
    const out = await tools.hera_run_program.execute({ skill: "release-notes", args: {} }, TOOL_CTX);
    expect(out).toContain("succeeded");
    expect(out).toContain("release-notes");
    expect(out).toContain('"title":"T"');
    expect(out).toContain("l1");
  });

  it("routes a failed run and surfaces the error", async () => {
    const tools = createProgramTools(ctxWithRunner({ ok: false, error: "boom", logs: [] }));
    const out = await tools.hera_run_program.execute({ skill: "x", args: undefined }, TOOL_CTX);
    expect(out).toContain("failed");
    expect(out).toContain("boom");
  });

  it("passes the session directory through to the runner", async () => {
    let seenDir = "";
    const ctx = {
      programRunner: {
        run: async (_skill: string, _args: unknown, c: { directory: string }) => {
          seenDir = c.directory;
          return { ok: true, value: null, logs: [] } as ProgramResult;
        },
      },
    } as unknown as PluginContext;
    const tools = createProgramTools(ctx);
    await tools.hera_run_program.execute({ skill: "x", args: {} }, TOOL_CTX);
    expect(seenDir).toBe("/work");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/program-tools.test.ts`
Expected: FAIL — `Cannot find module './program-tools.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/tools/program-tools.ts`:

```ts
// src/tools/program-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";

const z = tool.schema;

export function createProgramTools(ctx: PluginContext) {
  return {
    hera_run_program: tool({
      description:
        "Run a program-led skill (one that ships a run.ts). Executes in a sandboxed child process; deterministic steps run in the child and llm steps run through Hera. Returns the program's structured result.",
      args: {
        skill: z.string().describe("Name of the program skill to run"),
        args: z.any().optional().describe("Arguments passed to the program's run(hera, args)"),
      },
      async execute(args, context) {
        const result = await ctx.programRunner.run(args.skill, args.args, {
          sessionID: context.sessionID,
          directory: context.directory,
        });
        const logs = result.logs.length ? `\nLogs:\n${result.logs.join("\n")}` : "";
        if (result.ok) {
          return `Program ${args.skill} succeeded.\nResult: ${JSON.stringify(result.value)}${logs}`;
        }
        return `Program ${args.skill} failed: ${result.error}${logs}`;
      },
    }),
  };
}
```

- [ ] **Step 4: Register the tool group in `src/tools/index.ts`**

Add the import (after `import { createRecoveryTools } from "./recovery-tools.js";`):

```ts
import { createProgramTools } from "./program-tools.js";
```

Add it to the merged `tools` object (after `...createRecoveryTools(ctx),`):

```ts
    ...createRecoveryTools(ctx),
    ...createProgramTools(ctx),
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/tools/program-tools.test.ts`
Expected: PASS — `3 pass, 0 fail`.

- [ ] **Step 6: Typecheck, lint, format**

Run: `bun run typecheck && bun run lint && bun run format`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/tools/program-tools.ts src/tools/program-tools.test.ts src/tools/index.ts
git commit -m "$(cat <<'EOF'
feat(tools): add hera_run_program to invoke program-led skills

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Scaffolding (CLI + tool) and build bundling

Adds authoring on both surfaces (repo parity requirement): `hera create skill <name> --program` in `bin/hera.js` and a `hera_create_program_skill` tool, both scaffolding `SKILL.json` (with `program`), `run.ts`, and `hera-sdk.d.ts`. Also teaches the build to emit a standalone `dist/program/child-harness.js` and ship it.

**Files:**
- Create: `src/tools/program-scaffold-tools.ts`
- Create: `src/tools/program-scaffold-tools.test.ts`
- Modify: `src/tools/index.ts` (register the scaffold tool)
- Modify: `bin/hera.js` (`create skill <name> --program` + `createProgramSkillFromCli`)
- Modify: `package.json` (bundle + ship the harness)

**Interfaces:**
- Consumes: `SkillManager.createSkill(pkg)` (Task 5 persists `program`); `RUN_TS_TEMPLATE`, `HERA_SDK_DTS` from `src/program/sdk-types.ts`; `PluginContext.skillManager`.
- Produces:
  - `export function createProgramScaffoldTools(ctx: PluginContext): { hera_create_program_skill: ToolDefinition }`.
  - CLI: `hera create skill <name> --program` writes `hera-data/skills/<name>/{SKILL.json,run.ts,hera-sdk.d.ts}`.
  - Build: `dist/program/child-harness.js` produced and listed in `package.json` `files`.

- [ ] **Step 1: Write the failing test**

Create `src/tools/program-scaffold-tools.test.ts`:

```ts
// src/tools/program-scaffold-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillManager } from "../skills/manager.js";
import { MemoryStore } from "../memory/store.js";
import { createProgramScaffoldTools } from "./program-scaffold-tools.js";
import type { PluginContext } from "../types.js";

const TOOL_CTX = { sessionID: "s1", directory: "/work", worktree: "/work" };

describe("hera_create_program_skill", () => {
  let root: string;
  let skillManager: SkillManager;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "scaffold-"));
    const store = new MemoryStore(join(root, "memory"));
    await store.init();
    skillManager = new SkillManager(store, join(root, "skills"));
    await skillManager.init();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("scaffolds a program skill dir with SKILL.json, run.ts, and hera-sdk.d.ts", async () => {
    const ctx = { skillManager } as unknown as PluginContext;
    const tools = createProgramScaffoldTools(ctx);
    const out = await tools.hera_create_program_skill.execute(
      { name: "release-notes", description: "Draft release notes" },
      TOOL_CTX
    );
    expect(out).toContain("release-notes");

    const dir = join(root, "skills", "release-notes");
    expect(JSON.parse(await readFile(join(dir, "SKILL.json"), "utf-8")).program).toBe("run.ts");
    expect(await readFile(join(dir, "run.ts"), "utf-8")).toContain("export default async function run");
    expect(await readFile(join(dir, "hera-sdk.d.ts"), "utf-8")).toContain("export interface Hera");

    // Loaded in-memory as a program skill.
    expect(skillManager.getSkillPackage("release-notes")?.program).toBe("run.ts");
  });

  it("rejects a built-in name", async () => {
    const ctx = { skillManager } as unknown as PluginContext;
    const tools = createProgramScaffoldTools(ctx);
    const out = await tools.hera_create_program_skill.execute(
      { name: "memory", description: "x" },
      TOOL_CTX
    );
    expect(out.toLowerCase()).toContain("built-in");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/program-scaffold-tools.test.ts`
Expected: FAIL — `Cannot find module './program-scaffold-tools.js'`.

- [ ] **Step 3: Write the scaffold tool**

Create `src/tools/program-scaffold-tools.ts`:

```ts
// src/tools/program-scaffold-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext, SkillPackage } from "../types.js";
import { HERA_SDK_DTS, RUN_TS_TEMPLATE } from "../program/sdk-types.js";

const z = tool.schema;

export function createProgramScaffoldTools(ctx: PluginContext) {
  return {
    hera_create_program_skill: tool({
      description:
        "Scaffold a new program-led skill: a directory with SKILL.json (program: run.ts), a typed run.ts entry, and hera-sdk.d.ts for autocomplete.",
      args: {
        name: z.string().describe("Skill name (kebab-case)"),
        description: z.string().describe("What the program does"),
      },
      async execute(args) {
        const pkg: SkillPackage = {
          name: args.name,
          description: args.description,
          trigger: "",
          category: "user",
          program: "run.ts",
          prompt: "",
          config: {},
          files: [
            { path: "run.ts", content: RUN_TS_TEMPLATE },
            { path: "hera-sdk.d.ts", content: HERA_SDK_DTS },
          ],
        };
        try {
          await ctx.skillManager.createSkill(pkg);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        return `Program skill "${args.name}" scaffolded (run.ts + hera-sdk.d.ts). Run it with hera_run_program({ skill: "${args.name}" }).`;
      },
    }),
  };
}
```

- [ ] **Step 4: Register the scaffold tool in `src/tools/index.ts`**

Add the import (after the `createProgramTools` import from Task 6):

```ts
import { createProgramScaffoldTools } from "./program-scaffold-tools.js";
```

Add it to the merged `tools` object (after `...createProgramTools(ctx),`):

```ts
    ...createProgramTools(ctx),
    ...createProgramScaffoldTools(ctx),
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/tools/program-scaffold-tools.test.ts`
Expected: PASS — `2 pass, 0 fail`.

- [ ] **Step 6: Add the CLI scaffold to `bin/hera.js` (repo parity)**

Add a `createProgramSkillFromCli` function near `createAgentFromCli` (after that function, around line 245). It writes the same three files the tool writes, using literal templates that match `RUN_TS_TEMPLATE`/`HERA_SDK_DTS` (bin/hera.js is plain JS and cannot import from `src/`):

```js
function createProgramSkillFromCli(name) {
  const configRoot = getConfigRoot();
  ensureRuntimeDirs(configRoot);
  const skillDir = path.join(configRoot, "hera-data", "skills", name);
  if (fs.existsSync(skillDir)) {
    console.log(`[✗] Skill "${name}" already exists at ${skillDir}`);
    process.exit(1);
  }
  fs.mkdirSync(skillDir, { recursive: true });

  const skillJson = {
    name,
    description: getFlag("--description", `Program skill ${name}`),
    trigger: "",
    category: "user",
    program: "run.ts",
  };
  fs.writeFileSync(path.join(skillDir, "SKILL.json"), JSON.stringify(skillJson, null, 2) + "\n", "utf-8");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "", "utf-8");

  const runTs = [
    'import type { Hera } from "./hera-sdk";',
    "",
    "export default async function run(hera: Hera, args: unknown) {",
    '  hera.log("program started");',
    '  const status = await hera.sh("git status --short");',
    "  return { ok: true, changed: status.stdout.trim().length > 0 };",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "run.ts"), runTs, "utf-8");

  const heraSdkDts = [
    "// Auto-generated by Hera. The authoring surface for this program skill.",
    "export interface Hera {",
    "  args: unknown;",
    "  log(message: string): void;",
    "  sh(cmd: string, opts?: { cwd?: string; timeoutMs?: number })",
    "    : Promise<{ stdout: string; stderr: string; code: number }>;",
    "  file: {",
    "    read(path: string): Promise<string>;",
    "    write(path: string, content: string): Promise<void>;",
    "    exists(path: string): Promise<boolean>;",
    "    list(dir: string): Promise<string[]>;",
    "  };",
    "  llm(prompt: string, opts?: { input?: unknown; schema?: object; executor?: string }): Promise<unknown>;",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "hera-sdk.d.ts"), heraSdkDts, "utf-8");

  console.log(`Program skill "${name}" scaffolded at ${skillDir}`);
  console.log("Edit run.ts, then run it with the hera_run_program tool.");
}
```

Then extend the `create` case (currently around line 472) to route `create skill <name> --program`:

```js
  case "create": {
    if (args[1] === "skill" && args[2]) {
      if (!flags.has("--program")) {
        console.log("Usage: hera create skill NAME --program");
        process.exit(1);
      }
      createProgramSkillFromCli(args[2]);
      break;
    }
    if (args[1] !== "agent" || !args[2]) {
      console.log("Usage: hera create agent NAME --template coder --mode all");
      console.log("       hera create skill NAME --program");
      process.exit(1);
    }
    createAgentFromCli(args[2]);
    break;
  }
```

- [ ] **Step 7: Verify the CLI scaffold end-to-end**

Run:
```bash
HERA_CONFIG_ROOT="$(mktemp -d)" node bin/hera.js create skill demo-prog --program && \
  ls "$HERA_CONFIG_ROOT/hera-data/skills/demo-prog"
```
Expected: prints `Program skill "demo-prog" scaffolded ...` and lists `SKILL.json  SKILL.md  hera-sdk.d.ts  run.ts`.

(Note: `HERA_CONFIG_ROOT` must be set in the same command so the subshell sees it; on Windows PowerShell use `$env:HERA_CONFIG_ROOT = (New-TemporaryFile).Directory.FullName` in a scratch dir instead.)

- [ ] **Step 8: Bundle the child harness in the build (`package.json`)**

Edit the `build` script to add a third `bun build` for the harness (insert before the `tsc` declaration step):

```json
    "build": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && bun build src/index.ts --outdir dist --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk && bun build src/engine/index.ts --outdir dist/engine --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk && bun build src/program/child-harness.ts --outdir dist/program --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk && tsc -p tsconfig.build.json --emitDeclarationOnly --declaration --outDir dist && echo 'build done'",
```

Add the harness to the published `files` array (after `"dist/index.js",`):

```json
  "files": [
    "dist/index.js",
    "dist/program/child-harness.js",
    "dist/**/*.d.ts",
    "bin",
    "postinstall.mjs",
    "hera.schema.json",
    "hera.example.json"
  ],
```

- [ ] **Step 9: Verify the build emits the harness bundle**

Run: `bun run build && ls dist/program/child-harness.js`
Expected: `build done` printed and `dist/program/child-harness.js` listed. (This is the file `defaultHarnessPath()` resolves at runtime in `dist`.)

- [ ] **Step 10: Full release gate**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: no type/lint errors; build done; entire suite passes with `0 fail` and coverage at or above the `bunfig.toml` floor.

- [ ] **Step 11: Format and commit**

Run: `bun run format`

```bash
git add src/tools/program-scaffold-tools.ts src/tools/program-scaffold-tools.test.ts src/tools/index.ts bin/hera.js package.json
git commit -m "$(cat <<'EOF'
feat(program): scaffold program skills (CLI + tool) and bundle harness

Add hera_create_program_skill and `hera create skill NAME --program`, both
emitting SKILL.json (program: run.ts), a typed run.ts, and hera-sdk.d.ts. Build
now emits and ships dist/program/child-harness.js for the runner to spawn.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (against `2026-07-08-program-led-engine-design.md`):**

- §2 Skill package shape (`program` in SKILL.json) → Task 4 (type) + Task 5 (persistence).
- §3 Hera SDK (`args`/`log`/`sh`/`file`/`llm`; sh/file local, llm RPC; agent/memory out of v1) → Task 3 `sdk-types.ts` + `createHeraSdk`.
- §4 Architecture: `sdk-types.ts` (Task 3), `rpc.ts` Bun IPC framing (Task 2), `child-harness.ts` (Task 3), `runner.ts` (Task 4), `index.ts` `createProgramRunner` (Task 4).
- §4.1 `llm` RPC handler (AgentRunner + schema validation + executor default "hera") → Task 4 `handleLlm` + `parseStructured` + `buildLlmPrompt`.
- §4.2 Shared shell-exec refactor (both acceptance and child `hera.sh`) → Task 1.
- §5 Invocation paths: model via `hera_run_program` → Task 6; user via `/mode` (Spec 1) consumes the frozen seam, not built here.
- §6 Authoring/scaffolding (CLI `--program` + `hera_create_program_skill`, CLI/plugin parity) → Task 7.
- §7 Error handling: missing/no program (Task 4 tests), child throw (Task 4), hang→timeout→tree-kill (Task 4), exit-without-result w/ stderr (Task 4 `onExit`), llm failure rethrown to author (Task 3 `llm` reject + Task 4 `handleLlm`), path-guard (Task 3 `resolveInDir`).
- §8 Testing: shell-exec (Task 1), rpc (Task 2), runner integration incl. mocked AgentRunner (Task 4), tool (Task 6).
- §9 Files touched — all present across Tasks 1–7.
- §10 Seam contract — `ProgramRunner`/`SessionCtx`/`ProgramResult` are OWNED by Plan 1 in `src/types.ts` and consumed here by import (see Cross-plan coordination); Task 4 adds only `SkillPackage.program?`.

**Type consistency:** `ProgramResult`/`SessionCtx`/`ProgramRunner` are defined once by Plan 1 in `src/types.ts` and imported here (not redefined); runner implements the interface via aliased import (`ProgramRunnerContract`) to avoid a class/interface name clash; `ChildToParent`/`RpcRequest`/`RpcResponse`/`RpcResult`/`RpcLog` used consistently across `rpc.ts`, `child-harness.ts`, `runner.ts`; `createHeraSdk`/`HarnessChannel` names match between harness and its test; `getSkillPackage` used consistently.

**Placeholder scan:** every code step contains complete code; no "TBD"/"similar to Task N"/"add validation" placeholders.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-program-led-engine.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).
2. **Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).

Which approach?
