// src/engine/index.ts
import { randomUUID } from "node:crypto";
import type { OpenCodeClient } from "../types/client.js";
import { TaskStore } from "./task-store.js";
import { LoopStore } from "./loop-store.js";
import { AcceptanceEvaluator } from "./acceptance.js";
import { TaskExecutor } from "./executor.js";
import { Supervisor } from "./supervisor.js";
import { LoopManager } from "./loop-manager.js";
import { OpenCodeAgentRunner } from "./opencode-agent-runner.js";
import { createTaskTools } from "../tools/task-tools.js";
import { createLoopTools } from "../tools/loop-tools.js";
import { createRecoveryTools } from "../tools/recovery-tools.js";
import { getDefaultPermission } from "../helpers.js";
import {
  TASK_CONCURRENCY,
  TASK_LEASE_MS,
  TASK_ATTEMPT_TIMEOUT_MS,
  SUPERVISOR_TICK_MS,
  LOOP_TICK_MS,
  LOOP_DEFAULT_MAX_ITERATIONS,
  LOOP_MIN_INTERVAL_MS,
  LOOP_MAX_CONSECUTIVE_FAILURES,
} from "../constants.js";

export { TaskStore } from "./task-store.js";
export { LoopStore } from "./loop-store.js";
export { AcceptanceEvaluator } from "./acceptance.js";
export { TaskExecutor } from "./executor.js";
export { Supervisor } from "./supervisor.js";
export { LoopManager } from "./loop-manager.js";
export { OpenCodeAgentRunner } from "./opencode-agent-runner.js";
export type { AgentRunner } from "./executor.js";
export * from "./task-types.js";
export * from "./loop-types.js";

export interface EngineConfig {
  task_concurrency?: number;
  task_lease_ms?: number;
  task_attempt_timeout_ms?: number;
  loop_tick_ms?: number;
  loop_default_max_iterations?: number;
  loop_min_interval_ms?: number;
  loop_max_consecutive_failures?: number;
}

export interface EngineOptions {
  dataDir: string;
  cwd: string;
  client: OpenCodeClient | undefined;
  config?: EngineConfig;
  ownerId?: string;
  teamManager?: { recoverSessions(): Promise<number> };
  /**
   * When true, reuse a single process-wide engine per dataDir. OpenCode loads
   * Hera and every generated agent/team plugin in ONE process; without this each
   * createEngine builds its own in-memory TaskStore over the SAME hera-data dir,
   * so two engines both see a task as pending and both run it (duplicate side
   * effects, last-writer-wins). The singleton makes them share one store.
   */
  singleton?: boolean;
}

// Process-wide engine registry keyed by absolute dataDir.
const engineRegistry = new Map<string, Engine>();

export interface Engine {
  taskStore: TaskStore;
  loopStore: LoopStore;
  loopManager: LoopManager;
  supervisor: Supervisor;
  executor: TaskExecutor;
  evaluator: AcceptanceEvaluator;
  tools: Record<string, unknown>;
  init(): Promise<void>;
  recover(): Promise<void>;
  start(): void;
  stop(): void;
}

const NOOP_TEAM = { recoverSessions: async () => 0 };

export function createEngine(opts: EngineOptions): Engine {
  if (opts.singleton) {
    const existing = engineRegistry.get(opts.dataDir);
    if (existing) return existing;
  }
  const c = opts.config ?? {};
  const taskStore = new TaskStore(opts.dataDir);
  const loopStore = new LoopStore(opts.dataDir);
  const runner = new OpenCodeAgentRunner(opts.client, opts.cwd);
  const evaluator = new AcceptanceEvaluator({
    shellEnabled: getDefaultPermission()?.bash !== "deny",
    defaultTimeoutMs: c.task_lease_ms ?? TASK_LEASE_MS,
    // Reuse the agent runner as the llm_judge backend when a client is present.
    judge: opts.client ? (prompt) => runner.run("hera", prompt) : undefined,
  });
  const executor = new TaskExecutor(
    taskStore,
    evaluator,
    runner,
    opts.cwd,
    c.task_attempt_timeout_ms ?? TASK_ATTEMPT_TIMEOUT_MS
  );
  const supervisor = new Supervisor(taskStore, executor, {
    concurrency: c.task_concurrency ?? TASK_CONCURRENCY,
    leaseMs: c.task_lease_ms ?? TASK_LEASE_MS,
    tickMs: SUPERVISOR_TICK_MS,
    ownerId: opts.ownerId ?? randomUUID(),
  });
  const loopManager = new LoopManager(loopStore, taskStore, evaluator, opts.cwd, {
    tickMs: c.loop_tick_ms ?? LOOP_TICK_MS,
    defaultMaxIterations: c.loop_default_max_iterations ?? LOOP_DEFAULT_MAX_ITERATIONS,
    minIntervalMs: c.loop_min_interval_ms ?? LOOP_MIN_INTERVAL_MS,
    maxConsecutiveFailures: c.loop_max_consecutive_failures ?? LOOP_MAX_CONSECUTIVE_FAILURES,
  });

  const toolCtx = {
    taskStore,
    loopManager,
    supervisor,
    teamManager: opts.teamManager ?? NOOP_TEAM,
  } as never;
  const tools: Record<string, unknown> = {
    ...createTaskTools(toolCtx),
    ...createLoopTools(toolCtx),
    ...createRecoveryTools(toolCtx),
  };

  // Latch init/recover so they run exactly once per engine, even when several
  // plugins (Hera + generated agent/team plugins) share the singleton and each
  // calls init()/recover(). Re-running init() would clear and rebuild the live
  // in-memory stores mid-tick, which can drop or resurrect in-flight tasks.
  let initPromise: Promise<void> | undefined;
  let recoverPromise: Promise<void> | undefined;

  const engine: Engine = {
    taskStore,
    loopStore,
    loopManager,
    supervisor,
    executor,
    evaluator,
    tools,
    init() {
      // On rejection, clear the latch so a later call retries. `??=` alone would
      // cache a rejected promise forever, permanently bricking the shared engine
      // after a single transient failure (e.g. a disk hiccup during startup).
      return (initPromise ??= (async () => {
        await taskStore.init();
        await loopStore.init();
      })().catch((e) => {
        initPromise = undefined;
        throw e;
      }));
    },
    recover() {
      return (recoverPromise ??= (async () => {
        await supervisor.recover();
        await loopManager.recover();
      })().catch((e) => {
        recoverPromise = undefined;
        throw e;
      }));
    },
    start() {
      supervisor.start();
      loopManager.start();
    },
    stop() {
      supervisor.stop();
      loopManager.stop();
      if (opts.singleton && engineRegistry.get(opts.dataDir) === engine) {
        engineRegistry.delete(opts.dataDir);
      }
    },
  };

  if (opts.singleton) engineRegistry.set(opts.dataDir, engine);
  return engine;
}
