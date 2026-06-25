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
}

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
  const c = opts.config ?? {};
  const taskStore = new TaskStore(opts.dataDir);
  const loopStore = new LoopStore(opts.dataDir);
  const evaluator = new AcceptanceEvaluator({
    shellEnabled: getDefaultPermission()?.bash !== "deny",
    defaultTimeoutMs: c.task_lease_ms ?? TASK_LEASE_MS,
  });
  const runner = new OpenCodeAgentRunner(opts.client, opts.cwd);
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

  return {
    taskStore,
    loopStore,
    loopManager,
    supervisor,
    executor,
    evaluator,
    tools,
    async init() {
      await taskStore.init();
      await loopStore.init();
    },
    async recover() {
      await supervisor.recover();
      await loopManager.recover();
    },
    start() {
      supervisor.start();
      loopManager.start();
    },
    stop() {
      supervisor.stop();
      loopManager.stop();
    },
  };
}
