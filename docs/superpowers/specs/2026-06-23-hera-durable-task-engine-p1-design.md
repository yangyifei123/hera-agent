# Hera Durable Task Engine (HDTE) — P1 Foundation Design

## Context

This is the first sub-project of a larger initiative to give Hera — and the
agents/teams it generates — durable, supervised, long-running task execution:
long sessions, high concurrency, large task volumes completed in full (≥500
tasks, no perfunctory completion), looping engineering, self-healing, and
scheduled recovery.

The full initiative is decomposed into four sequenced sub-projects:

- **P1 (this spec)** — Durable task ledger + concurrency executor + acceptance-
  based completion + minimal supervisor recovery, plus the shared persistence
  base they sit on.
- **P2** — Four-mode loop engine (iterate-until-goal, scheduled-recurring,
  watch, drain-queue) on top of P1's supervisor.
- **P3** — Self-healing + scheduled recovery (stuck/orphan detection, periodic
  recovery timers; extend `TeamManager` session recovery).
- **P4** — Engine modularization + injection into generated agents/teams
  (reusable `src/engine/*`, regenerate `plugin-generator` / `team-plugin-
  generator`), plus long-session compaction relay.

P2/P3 depend on P1's ledger + supervisor. P4 depends on P1–P3 settling.

## Locked decisions (from brainstorming)

1. **Runtime model: in-process supervisor.** The execution loop runs inside the
   OpenCode plugin process. Durability lives on disk; on next startup the
   supervisor recovers incomplete work from the ledger. No daemon, no OS
   scheduler in P1.
2. **Completion judgment: declarative acceptance checks.** A task is "done" only
   when its machine-executable acceptance checks pass. No LLM verifier. This is
   the anti-perfunctory ("不滥竽充数") mechanism.
3. **Storage: dedicated `TaskStore` (option A)** built on a shared atomic-write
   persistence base, not folded into `MemoryStore`.
4. **Memory refactor scope: structural extraction + index, behavior-preserving.**
   Extract a shared `JsonCollectionStore`; refactor `MemoryStore` onto it with
   identical external behavior (existing memory tests must stay green); build
   `TaskStore` on the same base. No new memory features (no fuzzy/vector search).

## Goal

Provide a disk-persisted, crash-recoverable, concurrency-limited task execution
substrate whose completion is judged by declarative acceptance checks, able to
flow ≥500 queued tasks through to genuine completion. Leave clean seams (lease,
recover, supervisor tick) for P2–P4.

## Non-goals (deferred)

- The four loop modes (P2).
- Periodic self-healing timers and stuck/orphan detection beyond startup
  recovery (P3).
- Generated-plugin injection and long-session compaction relay (P4).
- New memory capabilities or any change to `MemoryStore`'s external behavior.
- LLM-based verification of task output.

## Architecture

### Component map

| Module | Responsibility | Depends on |
|---|---|---|
| `src/store/json-collection-store.ts` `JsonCollectionStore` | Generic durable disk JSON-per-entry store: atomic write, safe-id guard, per-collection subdir, in-memory primary index (built on `init`, maintained on write/delete), optional secondary field indexes | `atomicWriteText`/`atomicWriteJson`, `node:fs` |
| `src/memory/store.ts` `MemoryStore` (refactored) | Thin layer over `JsonCollectionStore`: keeps type→subdir map in one place, TTL/expiry, `maxEntries` enforcement, `search`. External API/behavior unchanged. | `JsonCollectionStore` |
| `src/engine/task-store.ts` `TaskStore` | Durable CRUD for `TaskRecord`; status secondary index; queries `pending`/`running`/retryable; stream-friendly (no full-table load) | `JsonCollectionStore` |
| `src/engine/acceptance.ts` `AcceptanceEvaluator` | Run all acceptance checks for a task; return pass/fail + `AcceptanceResult[]` proof | `node:child_process` (gated+timed), `node:fs` |
| `src/engine/executor.ts` `TaskExecutor` | Execute one attempt: invoke executor agent (reuse workflow/team session pattern), capture output, run acceptance, write status+proof | `OpenCodeClient`, `AcceptanceEvaluator`, `TaskStore` |
| `src/engine/supervisor.ts` `Supervisor` | Scheduling loop: reclaim expired leases, pick ready tasks up to `concurrency`, lease + dispatch; `recover()` on startup | `TaskStore`, `TaskExecutor`, config |
| `src/tools/task-tools.ts` | `hera_enqueue_task`, `hera_enqueue_batch`, `hera_task_status`, `hera_list_tasks`, `hera_cancel_task`, `hera_batch_report` | engine |
| `src/index.ts` (wiring) | Instantiate engine, start supervisor, run `recover()` once at startup | engine, config |

### Why a shared base

`TaskStore` and `MemoryStore` want the same primitives (atomic write, safe id,
per-collection subdir, listing). Today `MemoryStore` re-reads and re-parses every
file on every `list()`, and `enforceLimit` calls `list()` after each `save`
(≈O(N²) at scale) — a trap `TaskStore` would inherit at 500 tasks. The shared
base adds an in-memory index so list/status queries do not re-scan disk, fixing
the efficiency problem for both and removing the duplicated type→subdir map.

## Data model

```ts
type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

interface TaskRecord {
  id: string;
  batchId?: string;
  goal: string;                 // instructions/prompt for the executor agent
  executor: string;             // agent name; default "hera"
  input?: unknown;
  acceptance: AcceptanceCheck[]; // ALL must pass; empty array is rejected at enqueue
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;          // retry budget (default from config)
  backoffMs?: number;           // base backoff between attempts
  lastError?: string;
  proof?: AcceptanceResult[];   // recorded check outputs = completion evidence
  dependsOn?: string[];         // optional ordering; task is not "ready" until deps succeeded
  leaseOwner?: string;          // supervisor instance id holding the task
  leaseExpiresAt?: number;      // lease deadline; used for crash recovery (P1) and stuck detection (P3)
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  completedAt?: number;
}

type AcceptanceCheck =
  | { type: "shell"; command: string; cwd?: string; expectExit?: number; timeoutMs?: number } // expectExit default 0
  | { type: "file_exists"; path: string }
  | { type: "regex"; source: "output" | "file"; path?: string; pattern: string };

interface AcceptanceResult {
  check: AcceptanceCheck;
  passed: boolean;
  detail?: string;   // exit code, matched/unmatched, missing path, timeout, etc.
  at: number;
}
```

**Anti-perfunctory hard rule:** a task with an empty `acceptance` array is
**rejected at enqueue**. Without a declared, machine-checkable standard, "done"
would degrade into self-report.

## Completion / retry semantics

One attempt = run the executor agent → capture output → run **all** acceptance
checks via `AcceptanceEvaluator`.

- All checks pass → `succeeded`; store `proof`; set `completedAt`.
- Any check fails (or the agent attempt errors) → `attempts++`. If
  `attempts < maxAttempts`, return to `pending` with backoff
  (`backoffMs * attempts`); else → `failed` with `lastError`.
- A failing/erroring agent invocation is a normal failed **attempt**, never a
  process crash.

**Batch completion** = every task with the same `batchId` is `succeeded`.
`hera_batch_report` returns the final accounting: succeeded count, failed list
with reasons, pending/running counts. The system **never reports partial success
as full success** (aligns with verification-before-completion).

## Concurrency / 500-task load

- Config `task_concurrency` (default 8). Each supervisor tick tops active
  executions up to the limit.
- 500 tasks live on disk in the ledger; N flow concurrently. Only active tasks
  are held in memory; the rest are pulled from the store via the status index.
  Memory stays bounded regardless of queue depth.
- The `Supervisor` tick is the single dispatch point; ready = `pending`, deps
  all `succeeded`, lease free.

## Recovery (P1 minimal self-healing)

On startup, `Supervisor.recover()`:

- Any task `running` whose `leaseExpiresAt` is absent or in the past → reset to
  `pending` (re-execute). This is the seed of self-healing; full periodic
  stuck/orphan detection and timers are P3.

## Error handling

- Agent/session failure → retryable failed attempt (not a crash).
- Acceptance `shell`/`regex(file)` checks are **permission-gated** (same gate as
  agent bash) and **timeout-bounded**; a timeout is a failed check with detail.
- Enqueue validates input: non-empty `goal`, non-empty `acceptance`, valid
  executor name, sane `maxAttempts`; invalid tasks are rejected with a clear
  message before any persistence.
- Store writes are atomic; a corrupt task/memory file is skipped on load with a
  warning (matches existing `MemoryStore` tolerance).

## Security note

Acceptance `shell` checks execute arbitrary commands. In the plugin context this
is within the user's existing agent-bash permission surface, but it is a real
surface for P4's generated standalone plugins. P1: gate shell/file-regex checks
behind the same permission as bash, bound them with timeouts, and document the
contract. P4 will revisit for exported plugins.

## Config additions (`hera.json` + `HeraConfig`)

- `task_concurrency?: number` (default 8)
- `task_default_max_attempts?: number` (default 3)
- `task_default_backoff_ms?: number` (default 1000)
- `task_lease_ms?: number` (default 300000) — lease duration; expiry drives
  recovery.

Add to both the runtime default object in `src/index.ts` and `HeraConfig` in
`src/types.ts`, per repo convention. Prefer constants in `src/constants.ts`.

## Tools

- `hera_enqueue_task` — enqueue one validated task; returns task id.
- `hera_enqueue_batch` — enqueue many (supports ≥500) under one `batchId`.
- `hera_task_status` — status + attempts + proof for one task.
- `hera_list_tasks` — filter by status/batch (uses status index).
- `hera_cancel_task` — mark `cancelled` (won't be picked up).
- `hera_batch_report` — final accounting for a batch (no partial-as-complete).

## Wiring

`src/index.ts` startup (after stores/managers init): construct `TaskStore`,
`AcceptanceEvaluator`, `TaskExecutor`, `Supervisor`; run `recover()`; start the
supervisor tick. The tick is a bounded `setInterval`-style pump that respects
`task_concurrency`. Merge `task-tools` into `createAllTools()` in
`src/tools/index.ts`.

## Testing

Tests live next to source under `src/`.

**Unit**
- `JsonCollectionStore`: save/load/delete/list; index built on init; index
  maintained on write/delete; secondary index query; safe-id rejection; corrupt
  file skipped on load.
- `MemoryStore` (refactored): existing memory tests stay green unchanged
  (behavior-preserving gate). Add one test asserting `enforceLimit` no longer
  re-scans all files per save (e.g. via call accounting or a large-N timing-free
  invariant).
- `TaskStore`: status-index queries; crash-recovery reset (`running`+expired
  lease → `pending`).
- `AcceptanceEvaluator`: each check type pass/fail; shell timeout → failed check;
  `regex` over output vs file.
- Retry: fails until budget exhausted → `failed`; passes mid-budget → `succeeded`.
- Batch accounting: a batch with one always-failing task reports failure, never
  full success.

**Integration**
- Enqueue a small batch with a mock executor + real acceptance checks
  (`file_exists`, `shell` exit 0); run the supervisor to drain; assert all
  `succeeded` and `proof` persisted.
- One task with an always-failing check exhausts attempts → `failed` and appears
  in `hera_batch_report`.

## Verification gate

```bash
bun run typecheck
bun run lint
bun run build
bun test
```

`MemoryStore` behavior-preservation is gated by the unchanged existing memory
tests passing. If a gate cannot run because tooling is unavailable, record the
exact blocker and do not claim pass.

## Forward hooks (do not implement in P1, but design for)

- `leaseOwner`/`leaseExpiresAt` and `Supervisor.recover()` are the seams P3 uses
  for periodic stuck/orphan detection and scheduled recovery.
- The `Supervisor` tick and `TaskStore` ready-query are the seams P2 uses to add
  loop modes (iterate/recurring/watch/drain).
- `src/engine/*` is structured so P4 can extract it as the reusable runtime that
  generated plugins bundle.

## Risks and mitigations

- **Risk:** memory refactor changes behavior subtly.
  **Mitigation:** keep `MemoryStore`'s public API identical; gate on unchanged
  existing tests; do the extraction as pure internal restructuring.
- **Risk:** acceptance shell checks are a security surface.
  **Mitigation:** permission-gate + timeout-bound in P1; revisit for exported
  plugins in P4.
- **Risk:** in-memory index drifts from disk under concurrent writes.
  **Mitigation:** single-process in-process model; all writes go through the
  store; index updated in the same call that writes the file.
- **Risk:** 500-task load causes memory/cpu blowup.
  **Mitigation:** only active tasks in memory; status-indexed pulls; bounded
  concurrency; no full-table loads in hot paths.

## Done definition

P1 is done when:

- `JsonCollectionStore` exists; `MemoryStore` is refactored onto it with existing
  memory tests green; `TaskStore` is built on it.
- Tasks complete only when declarative acceptance checks pass; retries respect
  the budget; failures are surfaced, never hidden as success.
- ≥500 queued tasks flow through bounded concurrency to genuine completion in an
  integration test.
- Startup recovery resets crashed `running` tasks.
- The verification gate passes or blockers are recorded with output.
