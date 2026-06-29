import { describe, it, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "./manager.js";
import { TEAM_MESSAGE_QUEUE_CAP } from "../constants.js";

describe("TeamManager.recoverSessions", () => {
  let dir: string;
  let store: MemoryStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "teamrec-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reconciles an idle session to completed with captured result", async () => {
    const client = fakeClient({ s1: { type: "idle" } }, { s1: "FINAL ANSWER" });
    const mgr = new TeamManager(store, client);
    await mgr.createTeam({
      name: "t",
      description: "d",
      members: [{ agentName: "a", role: "dev" }],
      coordination: "parallel",
    } as never);
    // seed a spawned session in a non-terminal state
    await store.save({
      id: "team-session-t",
      type: "team-session",
      content: JSON.stringify({
        teamName: "t",
        sessions: [{ agentName: "a", sessionId: "s1", status: "running" }],
      }),
      timestamp: 1,
    });
    await mgr.init(); // reloads sessions (running -> unknown)
    const changed = await mgr.recoverSessions();
    expect(changed).toBeGreaterThanOrEqual(1);
    const sessions = mgr.getSpawnedSessions("t");
    expect(sessions.find((s) => s.sessionId === "s1")?.status).toBe("completed");
  });

  it("returns 0 with no client", async () => {
    const mgr = new TeamManager(store, undefined);
    const changed = await mgr.recoverSessions();
    expect(changed).toBe(0);
  });
});

function fakeClient(
  statusById: Record<string, { type: string }>,
  messages: Record<string, string> = {}
) {
  return {
    session: {
      status: async () => ({ data: statusById }),
      messages: async ({ path }: { path: { id: string } }) => ({
        data: [{ info: { role: "assistant" }, parts: [{ text: messages[path.id] ?? "" }] }],
      }),
      create: async () => ({ data: { id: "x" } }),
      promptAsync: async () => ({}),
    },
  } as never;
}

describe("TeamManager resource limits", () => {
  let tempDir: string;
  let store: MemoryStore;
  let manager: TeamManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hera-team-manager-"));
    store = new MemoryStore(tempDir, { maxEntries: TEAM_MESSAGE_QUEUE_CAP + 20 });
    await store.init();
    manager = new TeamManager(store, undefined);
    await manager.init();
    await manager.createTeam({
      name: "cap-team",
      description: "Queue cap team",
      coordination: "parallel",
      members: [
        { agentName: "alpha", role: "reviewer", subscriptions: [], backendType: "in-process" },
      ],
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("caps retained team messages and prunes oldest persisted entries", async () => {
    for (let i = 0; i < TEAM_MESSAGE_QUEUE_CAP + 5; i++) {
      await manager.sendMessage("cap-team", "alpha", "broadcast", `message-${i}`);
    }

    const messages = manager.getMessages("cap-team", "alpha", TEAM_MESSAGE_QUEUE_CAP + 10);
    expect(messages).toHaveLength(TEAM_MESSAGE_QUEUE_CAP);
    expect(messages[0].content).toBe("message-5");

    const persisted = await store.list("team-message");
    expect(persisted).toHaveLength(TEAM_MESSAGE_QUEUE_CAP);
  });

  test("keeps an unacknowledged directed message through broadcast overflow", async () => {
    // A directed message that no one has acknowledged yet.
    await manager.sendMessage("cap-team", "beta", "alpha", "IMPORTANT-DIRECTED", "task");

    // Flood the queue with broadcast chatter to force overflow eviction.
    for (let i = 0; i < TEAM_MESSAGE_QUEUE_CAP + 5; i++) {
      await manager.sendMessage("cap-team", "alpha", "broadcast", `chatter-${i}`);
    }

    const messages = manager.getMessages("cap-team", "alpha", TEAM_MESSAGE_QUEUE_CAP + 50);
    // The directed message survives even though it is the oldest entry.
    expect(messages.some((m) => m.content === "IMPORTANT-DIRECTED")).toBe(true);
    // Queue stays at the cap; broadcasts are evicted first.
    expect(messages).toHaveLength(TEAM_MESSAGE_QUEUE_CAP);

    const persisted = await store.list("team-message");
    expect(persisted.some((m) => m.content.includes("IMPORTANT-DIRECTED"))).toBe(true);
  });

  test("evicts a directed message once its required recipient acknowledges it", async () => {
    await manager.sendMessage("cap-team", "beta", "alpha", "ACKED-DIRECTED", "task");
    await manager.acknowledgeMessages("cap-team", "alpha");

    for (let i = 0; i < TEAM_MESSAGE_QUEUE_CAP + 5; i++) {
      await manager.sendMessage("cap-team", "alpha", "broadcast", `chatter-${i}`);
    }

    const messages = manager.getMessages("cap-team", "alpha", TEAM_MESSAGE_QUEUE_CAP + 50);
    // Now fully acknowledged, it is eligible for normal FIFO eviction.
    expect(messages.some((m) => m.content === "ACKED-DIRECTED")).toBe(false);
    expect(messages).toHaveLength(TEAM_MESSAGE_QUEUE_CAP);
  });
});

describe("TeamManager.spawnTeam coordination correctness", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "teamspawn-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does not poison the downstream prompt when an upstream session fails", async () => {
    const prompts: { sessionId: string; agent: string; text: string }[] = [];
    let nextId = 0;
    const client = {
      session: {
        create: async () => ({ data: { id: `sess-${++nextId}` } }),
        promptAsync: async ({
          path,
          body,
        }: {
          path: { id: string };
          body: { agent: string; parts: { text?: string }[] };
        }) => {
          prompts.push({
            sessionId: path.id,
            agent: body.agent,
            text: body.parts.map((p) => p.text ?? "").join(""),
          });
          return {};
        },
        // Every session reports idle immediately.
        status: async () => ({ data: { "sess-1": { type: "idle" }, "sess-2": { type: "idle" } } }),
        // The upstream session (sess-1) goes idle with NO assistant message,
        // i.e. it failed to produce a real result.
        messages: async ({ path }: { path: { id: string } }) =>
          path.id === "sess-1"
            ? { data: [{ info: { role: "user" }, parts: [{ text: "task" }] }] }
            : { data: [{ info: { role: "assistant" }, parts: [{ text: "downstream output" }] }] },
      },
    } as never;

    const mgr = new TeamManager(store, client);
    await mgr.createTeam({
      name: "seq",
      description: "d",
      coordination: "sequential",
      members: [
        { agentName: "upstream", role: "dev" },
        { agentName: "downstream", role: "dev" },
      ],
    } as never);

    const sessions = await mgr.spawnTeam("seq", "do the thing", "parent", dir);

    // Downstream must never be spawned/prompted once upstream failed.
    expect(prompts.some((p) => p.agent === "downstream")).toBe(false);
    // No prompt should carry a sentinel like "(error)"/"(timeout)" as input.
    expect(prompts.every((p) => !/\((error|timeout|no-client|no response)\)/.test(p.text))).toBe(
      true
    );
    // The chain aborted at upstream; only one session recorded, not completed.
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentName).toBe("upstream");
    expect(sessions[0].status).not.toBe("completed");
  });

  it("forwards real upstream output to the downstream member when completed", async () => {
    const prompts: { agent: string; text: string }[] = [];
    let nextId = 0;
    const client = {
      session: {
        create: async () => ({ data: { id: `sess-${++nextId}` } }),
        promptAsync: async ({ body }: { body: { agent: string; parts: { text?: string }[] } }) => {
          prompts.push({ agent: body.agent, text: body.parts.map((p) => p.text ?? "").join("") });
          return {};
        },
        status: async () => ({ data: { "sess-1": { type: "idle" }, "sess-2": { type: "idle" } } }),
        messages: async () => ({
          data: [{ info: { role: "assistant" }, parts: [{ text: "UPSTREAM RESULT" }] }],
        }),
      },
    } as never;

    const mgr = new TeamManager(store, client);
    await mgr.createTeam({
      name: "seq2",
      description: "d",
      coordination: "sequential",
      members: [
        { agentName: "upstream", role: "dev" },
        { agentName: "downstream", role: "dev" },
      ],
    } as never);

    const sessions = await mgr.spawnTeam("seq2", "do the thing", "parent", dir);
    const downstreamPrompt = prompts.find((p) => p.agent === "downstream");
    expect(downstreamPrompt).toBeDefined();
    expect(downstreamPrompt?.text).toContain("UPSTREAM RESULT");
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.status === "completed")).toBe(true);
  });

  it("does not fan out to executors when the adaptive planner fails", async () => {
    const prompts: { agent: string }[] = [];
    let nextId = 0;
    const client = {
      session: {
        create: async () => ({ data: { id: `sess-${++nextId}` } }),
        promptAsync: async ({ body }: { body: { agent: string } }) => {
          prompts.push({ agent: body.agent });
          return {};
        },
        status: async () => ({ data: { "sess-1": { type: "idle" } } }),
        // Planner goes idle without producing any assistant plan.
        messages: async () => ({ data: [{ info: { role: "user" }, parts: [{ text: "x" }] }] }),
      },
    } as never;

    const mgr = new TeamManager(store, client);
    await mgr.createTeam({
      name: "adapt",
      description: "d",
      coordination: "adaptive",
      members: [
        { agentName: "planner", role: "lead" },
        { agentName: "executor", role: "dev" },
      ],
    } as never);

    const sessions = await mgr.spawnTeam("adapt", "plan it", "parent", dir);
    expect(prompts.some((p) => p.agent === "executor")).toBe(false);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentName).toBe("planner");
    expect(sessions[0].status).not.toBe("completed");
  });

  it("retains in-flight sessions from a prior spawn when re-spawning", async () => {
    // No client => sessions are recorded as in-flight (pending).
    const mgr = new TeamManager(store, undefined);
    await mgr.createTeam({
      name: "respawn",
      description: "d",
      coordination: "parallel",
      members: [{ agentName: "worker", role: "dev" }],
    } as never);

    const first = await mgr.spawnTeam("respawn", "task one", "parent", dir);
    const firstId = first[0].sessionId;
    expect(mgr.getSpawnedSessions("respawn").map((s) => s.sessionId)).toContain(firstId);

    const second = await mgr.spawnTeam("respawn", "task two", "parent", dir);
    const secondId = second[0].sessionId;

    const tracked = mgr.getSpawnedSessions("respawn").map((s) => s.sessionId);
    // The first run's still-live session is not orphaned by the second spawn.
    expect(tracked).toContain(firstId);
    expect(tracked).toContain(secondId);

    // And the merged set is persisted so recovery can still reach it.
    const reloaded = new TeamManager(store, undefined);
    await reloaded.init();
    expect(reloaded.getSpawnedSessions("respawn").map((s) => s.sessionId)).toContain(firstId);
  });
});

describe("TeamManager.createTeam governance preservation", () => {
  let dir: string;
  let store: MemoryStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "teamgov-"));
    store = new MemoryStore(join(dir, "memory"));
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("preserves control points / objectives / workflow on a same-name re-create", async () => {
    const mgr = new TeamManager(store, undefined);
    await mgr.createTeam({
      name: "gov",
      description: "d",
      members: [{ agentName: "a", role: "dev" }],
      coordination: "parallel",
      management: "control",
      controlPoints: [
        { id: "cp-1", name: "gate", type: "gate", condition: "coverage>=80", action: "approve" },
      ],
      objectives: [{ id: "o-1", name: "Obj", keyResults: [] }],
    } as never);

    // Re-create with a bare definition (no governance fields) — as hera_create_team does.
    await mgr.createTeam({
      name: "gov",
      description: "d2",
      members: [{ agentName: "a", role: "dev" }],
      coordination: "parallel",
    } as never);

    const t = mgr.getTeam("gov") as never as {
      controlPoints?: unknown[];
      objectives?: unknown[];
      management?: string;
    };
    expect(t.controlPoints).toHaveLength(1);
    expect(t.objectives).toHaveLength(1);
    expect(t.management).toBe("control");
  });
});
