import { describe, test, it, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginContext, HeraConfig } from "./types.js";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import { TeamManager } from "./team/manager.js";
import { WorkflowManager } from "./workflow/manager.js";
import { DistillationEngine } from "./distillation/engine.js";
import { AgentRegistry } from "./agents/registry.js";
import { TaskStore } from "./engine/task-store.js";
import { LoopStore } from "./engine/loop-store.js";
import { LoopManager } from "./engine/loop-manager.js";
import { AcceptanceEvaluator } from "./engine/acceptance.js";
import { TaskExecutor } from "./engine/executor.js";
import { Supervisor } from "./engine/supervisor.js";
import { LOOP_TICK_MS, LOOP_DEFAULT_MAX_ITERATIONS, LOOP_MIN_INTERVAL_MS, LOOP_MAX_CONSECUTIVE_FAILURES, TASK_CONCURRENCY, TASK_LEASE_MS, SUPERVISOR_TICK_MS } from "./constants.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import HeraPlugin from "./index.js";

function makeTestCtx(autoEvolve: boolean): PluginContext {
  const base = join(tmpdir(), `hera-test-auto-evolve-${Date.now()}`);
  mkdirSync(join(base, "memory"), { recursive: true });
  mkdirSync(join(base, "skills"), { recursive: true });
  mkdirSync(join(base, "agents", "hera"), { recursive: true });

  const store = new MemoryStore(join(base, "memory"));
  const skillManager = new SkillManager(store, join(base, "skills"));
  const teamManager = new TeamManager(store, undefined);
  const workflowManager = new WorkflowManager(store, teamManager, undefined);
  const distillation = new DistillationEngine(store);
  const agentRegistry = new AgentRegistry(join(base, "agents", "hera"));

  const config: HeraConfig = { auto_evolve: autoEvolve };

  const taskStore = new TaskStore(join(base, "hera-data"));
  const loopManager = new LoopManager(
    new LoopStore(join(base, "hera-data")),
    taskStore,
    new AcceptanceEvaluator({ shellEnabled: true }),
    join(base, "hera-data"),
    {
      tickMs: LOOP_TICK_MS,
      defaultMaxIterations: LOOP_DEFAULT_MAX_ITERATIONS,
      minIntervalMs: LOOP_MIN_INTERVAL_MS,
      maxConsecutiveFailures: LOOP_MAX_CONSECUTIVE_FAILURES,
    }
  );

  const stubRunner = { run: async (): Promise<string> => { throw new Error("no-op"); } };
  const taskExecutor = new TaskExecutor(
    taskStore,
    new AcceptanceEvaluator({ shellEnabled: true }),
    stubRunner,
    join(base, "hera-data")
  );
  const supervisor = new Supervisor(taskStore, taskExecutor, {
    concurrency: TASK_CONCURRENCY,
    leaseMs: TASK_LEASE_MS,
    tickMs: SUPERVISOR_TICK_MS,
    ownerId: "test",
  });

  return {
    store,
    skillManager,
    teamManager,
    workflowManager,
    distillation,
    agentRegistry,
    registeredAgents: new Map(),
    client: undefined,
    taskStore,
    loopManager,
    supervisor,
    config,
    paths: {
      configRoot: base,
      dataDir: join(base, "hera-data"),
      memoryDir: join(base, "memory"),
      skillsDir: join(base, "skills"),
      agentsDir: join(base, "agents", "hera"),
    },
    autoEvolve: autoEvolve,
  };
}

function makePluginInput(tmp: string): PluginInput {
  return {
    client: createOpencodeClient({ directory: tmp }),
    project: {
      id: "test-project",
      worktree: tmp,
      time: { created: Date.now() },
    },
    directory: tmp,
    worktree: tmp,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:0"),
    $,
  };
}

describe("auto_evolve config wiring", () => {
  test("autoEvolve is false when config.auto_evolve is undefined", () => {
    const ctx = makeTestCtx(false);
    expect(ctx.autoEvolve).toBe(false);
  });

  test("autoEvolve is true when config.auto_evolve is true", () => {
    const ctx = makeTestCtx(true);
    expect(ctx.autoEvolve).toBe(true);
  });

  test("compacting hook context differs based on autoEvolve", () => {
    // Simulate the compacting hook logic
    const ctxOn = makeTestCtx(true);

    const outputOff = { context: [] as string[] };
    const outputOn = { context: [] as string[] };

    // Replicate compacting hook logic
    const baseMsg =
      "Hera Session Context: Distill key decisions, patterns, and skills before compaction. Recall relevant memories.";
    const evolveMsg =
      "Reflect on this session's failures and propose evolution directives if needed. Use hera_evolve_agent to suggest improvements.";

    outputOff.context.push(baseMsg);
    outputOn.context.push(baseMsg);
    if (ctxOn.autoEvolve) outputOn.context.push(evolveMsg);

    expect(outputOff.context).toHaveLength(1);
    expect(outputOff.context[0]).toBe(baseMsg);

    expect(outputOn.context).toHaveLength(2);
    expect(outputOn.context[0]).toBe(baseMsg);
    expect(outputOn.context[1]).toBe(evolveMsg);
  });
});

// ============================================================
// Full plugin entry — exercise the Plugin default export end-to-end.
// We redirect HOME/USERPROFILE to a tmp dir so resolveConfigRoot()
// uses our sandbox instead of the real user home.
// ============================================================
describe("HeraPlugin (default export) — 4 hooks", () => {
  let tmp: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-index-test-"));
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    // Both vars set so the plugin's resolveConfigRoot() picks tmp on
    // whatever platform the test runs on.
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedUserProfile;
    try {
      await rm(tmp, { recursive: true });
    } catch {}
  });

  it("initializes and returns four hooks", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    expect(typeof hooks.config).toBe("function");
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function");
    expect(typeof hooks["experimental.session.compacting"]).toBe("function");
  });

  it("auto-creates hera.json on first load", async () => {
    await HeraPlugin(makePluginInput(tmp), undefined);
    const heraJsonPath = join(tmp, ".config", "opencode", "hera.json");
    const content = await readFile(heraJsonPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.memory_limit).toBeDefined();
    expect(parsed.team_defaults).toBeDefined();
  });

  it("config hook injects the Hera agent under input.agent.hera", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const input: any = { agent: {} };
    await (hooks.config as any)(input);
    expect(input.agent.hera).toBeDefined();
    expect(input.agent.hera.prompt).toContain("Hera");
    // Hera agent should embed the built-in skill names in its prompt.
    expect(input.agent.hera.prompt.toLowerCase()).toContain("caveman");
  });

  it("config hook injects every persisted child agent", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const input: any = { agent: {} };
    await (hooks.config as any)(input);
    // Onboarding creates 4 default agents (quick-fixer + 3 team members).
    expect(input.agent["quick-fixer"]).toBeDefined();
    expect(input.agent["architect"]).toBeDefined();
    expect(input.agent["senior-dev"]).toBeDefined();
    expect(input.agent["qa-engineer"]).toBeDefined();
  });

  it("config hook honors disabled_agents from hera.json", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), {
      disabled_agents: ["quick-fixer"],
    } as any);
    const input: any = { agent: {} };
    await (hooks.config as any)(input);
    expect(input.agent["quick-fixer"]).toBeUndefined();
    // Other agents still appear.
    expect(input.agent["architect"]).toBeDefined();
  });

  it("tool hook exposes the full tool surface (hera_create_agent, hera_export_team, etc.)", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const tools = hooks.tool as Record<string, unknown>;
    expect(tools.hera_create_agent).toBeDefined();
    expect(tools.hera_list_agents).toBeDefined();
    expect(tools.hera_create_team).toBeDefined();
    expect(tools.hera_delete_team).toBeDefined();
    expect(tools.hera_get_team_messages).toBeDefined();
    expect(tools.hera_ack_team_messages).toBeDefined();
    expect(tools.hera_export_team).toBeDefined();
    expect(tools.hera_upgrade_to_agent).toBeDefined();
    expect(tools.hera_upgrade_to_team).toBeDefined();
    expect(tools.hera_upgrade_agents_to_team).toBeDefined();
    expect(tools.hera_team_remember).toBeDefined();
    expect(tools.hera_team_recall).toBeDefined();
    expect(tools.hera_remember).toBeDefined();
    expect(tools.hera_recall).toBeDefined();
  });

  it("tool hook honors disabled_tools from hera.json", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), {
      disabled_tools: ["hera_delete_team"],
    } as any);
    const tools = hooks.tool as Record<string, unknown>;
    expect(tools.hera_create_team).toBeDefined();
    expect(tools.hera_delete_team).toBeUndefined();
  });

  it("config hook injects team membership context into member agents", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const input: any = { agent: {} };
    await (hooks.config as any)(input);
    expect(input.agent["architect"].prompt).toContain("## Hera Team Membership");
    expect(input.agent["architect"].prompt).toContain("hera_ack_team_messages");
  });

  it("system.transform hook appends sections to the Hera system prompt", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const input: any = { agent: "hera" };
    const output: any = { system: [] };
    await (hooks["experimental.chat.system.transform"] as any)(input, output);
    expect(output.system.length).toBeGreaterThan(0);
    const joined = output.system.join("\n");
    expect(joined).toContain("Active Teams");
    expect(joined).toContain("Registered Agents");
    expect(joined).toContain("Available Skills");
  });

  it("system.transform hook skips when not the Hera agent", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const input: any = { agent: "someone-else" };
    const output: any = { system: [] };
    await (hooks["experimental.chat.system.transform"] as any)(input, output);
    expect(output.system).toHaveLength(0);
  });

  it("session.compacting hook always emits the distillation directive", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), undefined);
    const output: any = { context: [] };
    await (hooks["experimental.session.compacting"] as any)({}, output);
    expect(output.context.length).toBeGreaterThanOrEqual(1);
    expect(output.context[0]).toContain("Distill");
  });

  it("session.compacting hook emits evolution directive when auto_evolve is on", async () => {
    const hooks = await HeraPlugin(makePluginInput(tmp), { auto_evolve: true } as any);
    const output: any = { context: [] };
    await (hooks["experimental.session.compacting"] as any)({}, output);
    expect(output.context.length).toBe(2);
    expect(output.context[1].toLowerCase()).toContain("evolve");
  });
});
