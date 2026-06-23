import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOnboarding } from "./onboarding.js";
import { AgentRegistry } from "./agents/registry.js";
import { TeamManager } from "./team/manager.js";
import { MemoryStore } from "./memory/store.js";
import { SkillManager } from "./skills/manager.js";
import type { HeraPaths } from "./types.js";

describe("runOnboarding", () => {
  let tmp: string;
  let paths: HeraPaths;
  let registry: AgentRegistry;
  let teamManager: TeamManager;
  let store: MemoryStore;
  let skillManager: SkillManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-onboarding-"));
    paths = {
      configRoot: tmp,
      dataDir: join(tmp, "hera-data"),
      memoryDir: join(tmp, "hera-data", "memory"),
      skillsDir: join(tmp, "hera-data", "skills"),
      agentsDir: join(tmp, "agents", "hera"),
    };

    await mkdir(paths.dataDir, { recursive: true });
    registry = new AgentRegistry(paths.agentsDir);
    await registry.init();
    store = new MemoryStore(paths.memoryDir);
    await store.init();
    skillManager = new SkillManager(store, paths.skillsDir);
    await skillManager.init();
    teamManager = new TeamManager(store, undefined);
    await teamManager.init();
  });

  afterEach(async () => {
    try {
      await rm(tmp, { recursive: true });
    } catch {}
  });

  it("should create the quick-fixer default agent", async () => {
    await runOnboarding(paths, registry, teamManager, store, skillManager);
    const files = await readdir(paths.agentsDir);
    expect(files).toContain("quick-fixer.md");
  });

  it("should create all member agents that dev-team references (no ghost team)", async () => {
    // Bug fixed: onboarding previously created dev-team referencing
    // architect/senior-dev/qa-engineer agents that didn't exist on disk.
    await runOnboarding(paths, registry, teamManager, store, skillManager);
    const files = await readdir(paths.agentsDir);

    const team = teamManager.getTeam("dev-team");
    expect(team).toBeDefined();

    // Every member agent referenced by dev-team must exist as a .md file.
    for (const member of team!.members) {
      expect(files).toContain(`${member.agentName}.md`);
    }
  });

  it("should create the dev-team default team", async () => {
    await runOnboarding(paths, registry, teamManager, store, skillManager);
    const team = teamManager.getTeam("dev-team");
    expect(team).toBeDefined();
    expect(team!.coordination).toBe("sequential");
    expect(team!.members.length).toBe(3);
  });

  it("should write the .onboarded flag", async () => {
    await runOnboarding(paths, registry, teamManager, store, skillManager);
    const flagPath = join(paths.dataDir, ".onboarded");
    const content = await readFile(flagPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it("should be idempotent — running twice should not throw", async () => {
    await runOnboarding(paths, registry, teamManager, store, skillManager);
    // Second run should silently succeed (or warn) without throwing.
    await runOnboarding(paths, registry, teamManager, store, skillManager);
    const files = await readdir(paths.agentsDir);
    expect(files).toContain("quick-fixer.md");
  });
});
