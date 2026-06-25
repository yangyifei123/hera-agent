# HDTE P3 — Self-Healing + Scheduled Recovery Design

## Context

Third HDTE sub-project. P1 shipped the durable task engine (TaskStore,
AcceptanceEvaluator, TaskExecutor, Supervisor with startup `recover()`); P2 added
the four-mode loop engine (LoopStore, LoopManager). Both run in-process with an
injectable clock and deterministic `tick(now)`.

P3 makes the engine **self-healing** at runtime, not just at startup. Today a
hung agent (a `runner.run` that never returns) leaves its task `"running"`
forever — the executor has no attempt timeout, and `Supervisor.recover()` runs
only at startup. Loops that keep spawning failing tasks never stop. Crashed team
sessions are marked `"unknown"` on load and never reconciled.

P4 (engine modularization + injection into generated agents/teams) follows.

## Locked decisions

1. **In-process self-healing.** Continues P1's runtime model: no daemon. Healing
   runs on the existing supervisor/loop ticks plus startup, with an injectable
   clock for deterministic tests.
2. **Attempt timeout is the primary anti-hang.** `TaskExecutor` time-bounds the
   agent call; a hung attempt becomes a normal failed attempt (retry/fail). The
   default attempt timeout is **strictly less than** the task lease so the
   supervisor never reclaims a task it is still executing.
3. **Periodic lease reclaim is the safety net.** The supervisor reclaims expired-
   lease `"running"` tasks every tick (reusing `TaskStore.recover`), catching
   tasks orphaned by a crashed attempt or a restarted process — not just at
   startup.
4. **Loop circuit-breaker.** A loop whose spawned tasks fail repeatedly trips to
   `failed` after K consecutive failures, centralized in `LoopManager`.
5. **Best-effort team session recovery.** `TeamManager.recoverSessions()` re-polls
   non-terminal/unknown sessions via the OpenCode client and resolves their
   status; absent a client it leaves them unknown.

## Goal

At runtime: hung agents fail within a bounded time; orphaned running tasks are
reclaimed and re-run; runaway-failing loops self-terminate; crashed team sessions
are reconciled. All deterministic under an injectable clock. Expose recovery and
health through tools.

## Non-goals (deferred)

- OS scheduler / daemon (still in-process).
- Engine extraction + generated-plugin injection (P4).
- Retry backoff scheduling (still deferred; out of scope here).
- Reattaching/replaying a hung agent's partial work (a timed-out attempt is just
  a failed attempt).

## Architecture

### Component changes

| Module | Change |
|---|---|
| `src/engine/executor.ts` | Add an attempt timeout: `runner.run` is raced against `attemptTimeoutMs`; on timeout the attempt fails (`agent error: attempt timed out after Nms`). New constructor option `attemptTimeoutMs`. |
| `src/engine/supervisor.ts` | At the start of each `dispatchOnce` (after the re-entrancy guard), call `await this.store.recover(this.clock())` to reclaim expired-lease orphans mid-run. Track a cumulative `reclaimedCount`; expose `stats()`. |
| `src/engine/loop-manager.ts` | Centralized circuit-breaker in `advance()`: before mode dispatch, compute the **trailing run of consecutive failures** among the loop's spawned tasks (`taskStore.byBatch(loop.id)`); at `maxConsecutiveFailures` → loop `failed`. Stateless (no counter field) — self-correcting. |
| `src/team/manager.ts` | Add `recoverSessions(): Promise<number>` — re-poll `unknown`/`running`/`pending` spawned sessions via the client, map idle→completed (capture last assistant text), errored→error; persist; return reconciled count. |
| `src/tools/system-tools.ts` (or new `src/tools/recovery-tools.ts`) | `hera_recover` (manual task reclaim), `hera_engine_health` (status counts + reclaim/active stats), `hera_recover_sessions` (team session reconcile). |
| `src/index.ts` | Pass `attemptTimeoutMs` to `TaskExecutor` from config; call `teamManager.recoverSessions()` best-effort at startup (after managers init, guarded by client presence). |

### Why attempt-timeout < lease (safety)

The supervisor's own in-flight attempt has `leaseExpiresAt = claimTime +
leaseMs`. With `attemptTimeoutMs < leaseMs`, the attempt always resolves (success
or failed) **before** the lease expires, so the task leaves `"running"` before
periodic reclaim could touch it. Periodic reclaim therefore only ever acts on
genuinely orphaned tasks (crashed attempt that never saved, or a dead prior
process). `Promise.race` discards a late-returning hung runner, so no double-save.

## Data / config

No new `LoopDefinition` field — the circuit-breaker is stateless (computed from
`taskStore.byBatch(loop.id)` each tick).

Constants (`src/constants.ts`):
- `TASK_ATTEMPT_TIMEOUT_MS = 240000` (4 min; < `TASK_LEASE_MS` 5 min)
- `LOOP_MAX_CONSECUTIVE_FAILURES = 5`

`HeraConfig` (additive optional): `task_attempt_timeout_ms?`,
`loop_max_consecutive_failures?`.

## Behaviour

### Executor attempt timeout
`runAttempt`: `output = await raceWithTimeout(runner.run(executor, prompt),
attemptTimeoutMs)`. On timeout, the race rejects → caught as `agentError` → the
existing fail path (retry if under budget, else failed). `output` stays
undefined (no output). A `0`/absent timeout means no timeout (back-compat for
callers that pass none).

### Supervisor periodic reclaim
`dispatchOnce`, right after setting `dispatching = true`:
`const reclaimed = await this.store.recover(this.clock()); this.reclaimedCount +=
reclaimed;` then proceed to claim/dispatch. Existing behaviour is unchanged when
there are no expired-lease orphans (our own active tasks have future leases).
`stats()` returns `{ active, reclaimed, concurrency }`.

### Loop circuit-breaker (centralized in `advance`, stateless)
Before the mode switch, compute the trailing run of consecutive failures among
the loop's spawned tasks:
1. `terminal = taskStore.byBatch(loop.id).filter(succeeded|failed).sort by
   (completedAt ?? updatedAt) ascending`.
2. Walk `terminal` from the end, counting `failed` until a non-`failed` is hit →
   `trailing`.
3. If `trailing >= maxConsecutiveFailures` → save loop `failed`
   (`lastError = "loop circuit-breaker: N consecutive task failures"`) and return
   (do not dispatch the mode).
4. Otherwise dispatch the mode normally.

This is stateless and self-correcting: any succeeded task breaks the trailing
run, so a single success resets the breaker. `drain` loops spawn no tasks
(`byBatch` empty) so the breaker never trips for them. The mode handlers are
unchanged except that **recurring and watch now set `currentTaskId` on enqueue**
(for status/observability parity with iterate; not required by the breaker).

### Team session recovery
`recoverSessions()`: for each team's spawned sessions whose status is `unknown`,
`running`, or `pending`, and only if a client with `session.status` is available:
poll status; `idle` → set `completed` and capture the last assistant message as
`result`; if the status call errors or the session is gone → set `error`. Persist
the updated `team-session` records. Return the count of sessions whose status
changed. No client → return 0, leave sessions as-is.

## Tools

- `hera_recover` — run `supervisor`'s reclaim now (`taskStore.recover(now)`),
  report how many running tasks were reset to pending.
- `hera_engine_health` — report task counts by status, loop counts by status,
  and supervisor `stats()` (active, reclaimed, concurrency).
- `hera_recover_sessions` — run `teamManager.recoverSessions()`, report the count
  reconciled.

These need `taskStore`, `loopManager`/`loopStore`, `teamManager`, and the
`supervisor` reachable from `PluginContext`. `taskStore`, `loopManager`,
`teamManager` are already on `PluginContext`; add `supervisor:
import("./engine/supervisor.js").Supervisor` so health/recover tools can read its
stats and trigger reclaim. Wiring populates it.

## Testing

Tests next to source.

**Unit**
- Executor: a runner that never resolves + small `attemptTimeoutMs` → attempt
  fails within budget (status pending or failed, `lastError` contains "timed
  out"); a fast runner under the timeout still succeeds; `attemptTimeoutMs`
  unset/0 → no timeout (legacy behaviour).
- Supervisor: a task left `running` with an expired lease is reclaimed and
  re-dispatched on the next `dispatchOnce`/`drain`; `stats().reclaimed`
  increments; existing supervisor tests stay green (no reclaim when leases are
  in the future).
- LoopManager circuit-breaker: a loop whose spawned tasks fail K times trips to
  `failed`; a success resets the counter; recurring/watch set `currentTaskId` on
  enqueue; existing loop tests stay green.
- TeamManager: `recoverSessions()` with a fake client maps an idle session to
  `completed` with captured result and an errored poll to `error`; with no
  client returns 0 and leaves sessions unknown.
- Tools: `hera_recover` resets an expired-lease task and reports the count;
  `hera_engine_health` reports non-empty status/stat lines; `hera_recover_sessions`
  reports the reconciled count.
- Constants: new defaults present; `TASK_ATTEMPT_TIMEOUT_MS < TASK_LEASE_MS`.

**Integration** (controlled clock, real engine)
- A hung-runner task plus a healthy task: the supervisor times out the hung
  attempt (failed) while completing the healthy one — the queue drains, the hung
  task ends `failed`, the healthy task `succeeded`.
- An orphaned `running` task (expired lease, no active attempt) is reclaimed and
  completed by a healthy runner across ticks.

## Verification gate

```bash
bun run typecheck
bun run lint
bun run build
bun test
```

Existing P1/P2 engine + loop tests must stay green (all P3 changes are additive
or guarded). Record blockers if a gate cannot run.

## Forward hooks

- `Supervisor.stats()`, `recoverSessions()`, and the circuit-breaker counters are
  observability seams P4's exported plugins reuse.
- `src/engine/*` stays self-contained for P4 extraction.

## Risks and mitigations

- **Risk:** periodic reclaim resets a legitimately long-running attempt.
  **Mitigation:** `attemptTimeoutMs < leaseMs` guarantees the attempt resolves
  before the lease expires; reclaim only touches expired leases.
- **Risk:** a late-returning hung runner double-saves.
  **Mitigation:** `Promise.race` discards the loser; the executor already
  returned a terminal/pending state.
- **Risk:** circuit-breaker trips on transient failures.
  **Mitigation:** counts only *consecutive* failures; any success resets; K
  default 5 and configurable.
- **Risk:** team recovery polls a slow/blocked client.
  **Mitigation:** best-effort, single status call per session, guarded by client
  presence; errors map the session to `error` rather than hanging.

## Done definition

P3 is done when: hung agents fail within `attemptTimeoutMs`; orphaned running
tasks are reclaimed mid-run; loops self-terminate after K consecutive failures;
`recoverSessions()` reconciles crashed team sessions; recovery/health tools work;
the verification gate passes or blockers are recorded.
