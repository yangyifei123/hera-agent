import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../memory/store.js";
import { TeamManager } from "./manager.js";
import { TEAM_MESSAGE_QUEUE_CAP } from "../constants.js";

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
