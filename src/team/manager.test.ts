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
    await mgr.createTeam({ name: "t", description: "d", members: [{ agentName: "a", role: "dev" }], coordination: "parallel" } as never);
    // seed a spawned session in a non-terminal state
    await store.save({ id: "team-session-t", type: "team-session", content: JSON.stringify({ teamName: "t", sessions: [{ agentName: "a", sessionId: "s1", status: "running" }] }), timestamp: 1 });
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

function fakeClient(statusById: Record<string, { type: string }>, messages: Record<string, string> = {}) {
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
});
