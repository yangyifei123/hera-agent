# HDTE P2 — Four-Mode Loop Engine Design

## Context

Second sub-project of the Hera Durable Task Engine (HDTE). P1 shipped the durable
task substrate: `JsonCollectionStore`, `TaskStore` (status/batch indexes,
`claimReady` with dependency gating, crash recovery), `AcceptanceEvaluator`
(shell/file_exists/regex, timeout + permission-gated), `TaskExecutor` (acceptance-
gated completion, retry-to-budget), and a `Supervisor` (concurrency-capped
dispatch with re-entrancy guard, `drain`, startup `recover`, injectable
`clock: () => number`). Task tools enqueue work; startup wiring runs the
supervisor.

P2 adds **looping engineering**: four loop modes that keep producing work over
time — iterate-until-goal, scheduled-recurring, watch (event/condition), and
drain-queue. P3 (self-healing + scheduled recovery) and P4 (engine
modularization + injection into generated agents/teams) follow.

## Locked decisions (from brainstorming)

1. **Loops are durable triggers that enqueue tasks into the existing
   `TaskStore`.** A loop decides *when to produce work*; P1's
   supervisor/executor/acceptance/recovery run the work. Maximum reuse, no second
   execution path.
2. **Clock/scheduler model: extend P1's pattern.** A `LoopManager.tick(now)`
   advances all active loops. Production drives it from a `setInterval`; tests
   call `tick(now)` directly with controlled timestamps. No reliance on real
   timers in tests — fully deterministic, mirroring P1's `Supervisor`.
3. **All four modes in P2:** `iterate`, `recurring`, `watch`, `drain`.
4. **iterate goal is configurable, default = task acceptance.** Each iteration
   spawns a fresh task; the loop stops when its (optional) loop-level
   `goal: AcceptanceCheck[]` passes, or — by default — when the spawned task
   succeeds; else it continues to `maxIterations`.
5. **watch is edge-triggered.** A watch loop enqueues one task on the condition's
   false→true transition (tracked via `lastConditionMet`), not every tick.
6. **scheduled-recurring uses a fixed interval** (`intervalMs`) plus an absolute
   `nextRunAt`. Full cron expressions are deferred to a later extension.
7. **One P1 extension:** add `output?: string` to `TaskRecord`; `TaskExecutor`
   records the agent's raw output so `iterate` can feed it forward for
   refinement. Behavior-preserving (purely additive field).

## Goal

Provide durable, restart-recoverable loops that, on a deterministic tick, enqueue
tasks into the P1 engine according to one of four modes, with per-loop lifecycle
(pause/resume/cancel) and exit conditions. Leave clean seams for P3/P4.

## Non-goals (deferred)

- Full cron expressions for `recurring` (interval-only in P2).
- Self-healing timers / stuck-loop detection beyond startup recovery (P3).
- Generated-plugin injection (P4).
- Any new execution path — loops never run agents or acceptance directly except
  to *evaluate* a watch condition / iterate goal via `AcceptanceEvaluator`.

## Architecture

### Component map

| Module | Responsibility | Depends on |
|---|---|---|
| `src/engine/loop-types.ts` | `LoopMode`, `LoopStatus`, `LoopDefinition` | `task-types` (AcceptanceCheck) |
| `src/engine/loop-store.ts` `LoopStore` | Durable CRUD for loops; `status` + `mode` secondary indexes; startup load | `JsonCollectionStore` |
| `src/engine/loop-manager.ts` `LoopManager` | `tick(now)` advances each active loop → enqueues tasks into `TaskStore`; `createLoop`/`pause`/`resume`/`cancel`/`get`/`list`; `recover()`; `start()`/`stop()` (own interval, `unref`'d) | `LoopStore`, `TaskStore`, `AcceptanceEvaluator` |
| `src/tools/loop-tools.ts` | `hera_create_loop`, `hera_list_loops`, `hera_loop_status`, `hera_pause_loop`, `hera_resume_loop`, `hera_cancel_loop` | `LoopManager` (via `PluginContext.loopManager`) |
| `src/engine/executor.ts` (extend) | Record agent `output` onto the task record on each attempt | `TaskStore` |
| `src/index.ts` (wiring) | Construct `LoopStore` + `LoopManager`, `recover()`, `start()` alongside the supervisor | engine, config |

### How loops produce and observe work

Each loop holds a `taskTemplate`. When a mode's trigger fires, `LoopManager`
builds a `TaskRecord` from the template (new id, `batchId = loop.id`,
`status: "pending"`) and saves it via `TaskStore.save`. The existing supervisor
then claims and runs it. To observe completion (needed by `iterate` and to dedupe
`watch`/in-flight iterations), `LoopManager` reads the spawned task's status from
`TaskStore.get(currentTaskId)` on each tick.

### Tick integration

`LoopManager` owns its own `setInterval(tick, LOOP_TICK_MS)` (separate from the
supervisor's dispatch interval, sharing the same injectable clock). Production
startup calls `loopManager.recover()` then `loopManager.start()`; tests call
`loopManager.tick(now)` directly. The supervisor is unchanged.

## Data model

```ts
type LoopMode = "iterate" | "recurring" | "watch" | "drain";
type LoopStatus = "active" | "paused" | "completed" | "cancelled" | "failed";

interface LoopTaskTemplate {
  goal: string;
  executor: string;            // default "hera"
  acceptance: AcceptanceCheck[]; // task-level acceptance (P1 completion gate); required non-empty
  maxAttempts?: number;
  input?: unknown;
}

interface LoopDefinition {
  id: string;
  name?: string;
  mode: LoopMode;
  status: LoopStatus;
  taskTemplate: LoopTaskTemplate;

  iterate?: { goal?: AcceptanceCheck[]; maxIterations: number; feedForward?: boolean };
  recurring?: { intervalMs: number; nextRunAt: number; maxRuns?: number; runs: number };
  watch?: { condition: AcceptanceCheck[]; lastConditionMet: boolean };
  drain?: { batchId?: string };

  iterations: number;     // count of triggers fired (tasks spawned)
  currentTaskId?: string; // last task spawned (for iterate sequencing / in-flight dedup)
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
```

P1 extension to `TaskRecord` (in `src/engine/task-types.ts`):

```ts
  output?: string;        // raw agent output from the most recent attempt
```

`TaskExecutor.runAttempt` sets `output` on both the succeeded and failed/retry
record writes (the value it already captures from the runner). On agent error,
`output` is left undefined (no output produced).

## Per-mode tick semantics

`LoopManager.tick(now)` iterates loops from `loopStore.byStatus("active")`. For
each, dispatch on `mode`. All task enqueues go through a shared
`enqueueFromTemplate(loop, extraInput?)` helper.

### iterate
1. If `currentTaskId` set and that task is still in flight (`pending`/`running`),
   do nothing. A task that is terminal (`succeeded`/`failed`/`cancelled`) or
   missing (deleted) counts as not-in-flight and proceeds to step 2.
2. Otherwise evaluate the goal:
   - if `iterate.goal` present → run it via `AcceptanceEvaluator` (output context
     = the last task's `output ?? ""`); goal met = all pass.
   - else → goal met = the last task `status === "succeeded"`.
   - (first tick, no prior task → goal not met.)
3. If goal met → `status = "completed"`.
4. Else if `iterations < iterate.maxIterations` → enqueue next task. When
   `feedForward`, set the new task's `input` to
   `{ previousOutput: lastTask?.output, previousError: lastTask?.lastError, original: taskTemplate.input }`.
   Set `currentTaskId`, `iterations++`.
5. Else (`iterations >= maxIterations`, goal unmet) → `status = "failed"`,
   `lastError = "iterate: max iterations reached without meeting goal"`.

### recurring
At `createLoop`, `nextRunAt` is initialized to `now + intervalMs` (first fire
after one interval, not immediately) and `runs = 0`.
1. If `now >= recurring.nextRunAt` → enqueue a task; `runs++`; set
   `nextRunAt = max(nextRunAt + intervalMs, now)` (fixed cadence, no burst catch-up
   when behind by multiple intervals).
2. If `recurring.maxRuns != null && runs >= maxRuns` → `status = "completed"`.

### watch
1. Evaluate `watch.condition` via `AcceptanceEvaluator` (output context = "";
   conditions are shell/file_exists/regex(file)).
2. `met = allPassed`. If `met && !watch.lastConditionMet` (edge) → enqueue a task.
3. Set `watch.lastConditionMet = met`. (Loop stays active indefinitely until
   cancelled.)

### drain
1. Does not enqueue. Read counts from `TaskStore` (scoped to `drain.batchId` via
   `byBatch` if set, else global `byStatus`).
2. If no `pending` and no `running` remain → `status = "completed"`. Otherwise
   stay active (the supervisor is already draining the queue).

## Lifecycle, recovery, error handling

- `pause` → `status = "paused"` (skipped by tick). `resume` → back to `active`.
  `cancel` → `status = "cancelled"`; optionally cancel the in-flight
  `currentTaskId` via `TaskStore` (set that task `cancelled` if non-terminal).
  Terminal statuses (`completed`/`failed`/`cancelled`) are never ticked.
- `recover()` on startup: active loops resume from persisted state. `recurring`
  with `nextRunAt <= now` fires once on the next tick then reschedules (missed
  runs are not back-filled). `watch.lastConditionMet` is persisted, so a
  condition that was already true does not re-fire on restart. `iterate` resumes
  from `currentTaskId` + `iterations`.
- Per-loop tick errors are caught, recorded to `lastError`, and do not affect
  other loops; the whole `tick` is wrapped so one bad loop can't halt the manager.
- Enqueue validation reuses P1's rule: a loop whose `taskTemplate.acceptance` is
  empty is rejected at `createLoop` (its spawned tasks could never be verified
  complete). `watch.condition` and `iterate.goal`, when present, must be
  non-empty.

## Config additions (`hera.json` + `HeraConfig`)

- `loop_tick_ms?: number` (default 1000) — LoopManager tick interval.
- `loop_default_max_iterations?: number` (default 25) — iterate cap when unset.
- `loop_min_interval_ms?: number` (default 1000) — floor for `recurring.intervalMs`.

Add to both the runtime default object in `src/index.ts` and `HeraConfig` in
`src/types.ts`. New constants in `src/constants.ts`: `LOOP_TICK_MS`,
`LOOP_DEFAULT_MAX_ITERATIONS`, `LOOP_MIN_INTERVAL_MS`.

## Tools

- `hera_create_loop` — create a loop (mode + taskTemplate + mode config);
  validates acceptance/condition/goal non-empty, clamps `intervalMs` to the
  floor, defaults `maxIterations`. Returns loop id.
- `hera_list_loops` — list loops, optional status filter (uses status index).
- `hera_loop_status` — one loop's mode, status, iterations, currentTask, lastError.
- `hera_pause_loop` / `hera_resume_loop` / `hera_cancel_loop` — lifecycle.

`PluginContext` gains `loopManager: LoopManager` (mirrors `taskStore`); wiring in
`src/index.ts` populates it; `createAllTools` merges `createLoopTools`; the test
harness provides a `LoopManager`.

## Testing

Tests live next to source under `src/`.

**Unit**
- `LoopStore`: CRUD; `status`/`mode` index queries; recover loads active loops.
- `LoopManager` per mode with a fixed clock + real `TaskStore` + a real
  `AcceptanceEvaluator`:
  - iterate: completes when a spawned task succeeds; exhausts to `failed` at
    `maxIterations`; `feedForward` injects prior `output`/`lastError` into the
    next task's `input`; respects a custom `iterate.goal`.
  - recurring: fires only when `now >= nextRunAt`; reschedules by `intervalMs`;
    does not burst-catch-up when far behind; completes at `maxRuns`.
  - watch: enqueues exactly once on false→true; does not re-enqueue while the
    condition stays true; re-arms after it goes false then true again.
  - drain: completes when pending+running reach zero (and respects `batchId`
    scoping); stays active while work remains.
  - lifecycle: paused loops are skipped; cancel marks cancelled and cancels an
    in-flight task; terminal loops aren't ticked.
  - tick error isolation: a loop whose condition evaluation throws records
    `lastError` and does not stop other loops from ticking.
- `TaskExecutor`: the new `output` field is persisted on success and on
  failure/retry (extend existing executor tests; agent-error path leaves it
  undefined).
- `loop-tools`: create validates empty acceptance/condition rejection and
  interval clamping; pause/resume/cancel transitions; status/list output.
- Constants: loop defaults present and sane.

**Integration** (controlled clock, real TaskStore + Supervisor + LoopManager)
- A recurring loop drives N task enqueues across advancing ticks; the supervisor
  drains them; assert N tasks succeeded and `runs === N`.
- An iterate loop reaches its goal within 3 iterations (a stub runner that
  succeeds on the 3rd attempt) and ends `completed`; assert distinct task records
  per iteration and feed-forward input on iterations 2–3.
- A watch loop enqueues one task when its file-condition flips true; assert no
  re-enqueue while true.
- A drain loop ends `completed` once the supervisor empties the queue.

## Verification gate

```bash
bun run typecheck
bun run lint
bun run build
bun test
```

`TaskExecutor`/`TaskRecord` changes must keep existing P1 engine tests green
(the `output` field is additive). If a gate cannot run because tooling is
unavailable, record the exact blocker and do not claim pass.

## Forward hooks (design for, don't build in P2)

- `LoopManager.tick`/`recover` and the persisted loop state are the seams P3 uses
  for stuck-loop detection and scheduled recovery timers.
- `recurring` is structured so a cron-expression scheduler can later replace the
  fixed-interval `nextRunAt` computation without touching the trigger path.
- `src/engine/*` (loops included) stays self-contained for P4 extraction into the
  reusable runtime that generated plugins bundle.

## Risks and mitigations

- **Risk:** loop tick and supervisor dispatch race on the same task records.
  **Mitigation:** loops only ever *create* new pending tasks and *read* status;
  they never mutate running tasks. The supervisor owns task execution. Single
  in-process model; all writes go through the stores.
- **Risk:** recurring drift / burst catch-up after the process was asleep.
  **Mitigation:** `nextRunAt = max(nextRunAt + intervalMs, now)` fires at most
  once per tick and skips missed runs.
- **Risk:** watch re-fires every tick.
  **Mitigation:** edge-trigger via persisted `lastConditionMet`.
- **Risk:** iterate never terminates.
  **Mitigation:** mandatory `maxIterations` (defaulted); exhaustion → `failed`.
- **Risk:** the `output` field bloats task records with large agent transcripts.
  **Mitigation:** store as-is in P2 (bounded by typical task output); a size cap
  can be added later if needed — noted, not implemented.

## Done definition

P2 is done when:

- `LoopStore` + `LoopManager` exist; all four modes behave per the tick semantics
  above; loops persist and recover across restart.
- Loops enqueue tasks into the existing `TaskStore` and the supervisor runs them
  unchanged; `TaskRecord.output` is recorded and feeds `iterate` refinement.
- Lifecycle (pause/resume/cancel) and exit conditions work; empty
  acceptance/condition is rejected at create.
- Loop tools expose the engine; startup wiring runs the LoopManager.
- The verification gate passes or blockers are recorded with output.
