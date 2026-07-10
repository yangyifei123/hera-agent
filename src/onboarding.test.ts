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

  it("should not overwrite a pre-existing user agent that shares a default agent's name", async () => {
    const distinctivePrompt = "You are MY custom architect. Do not touch. USER_MARKER_12345.";
    const skills = skillManager.getSkillMap();
    await registry.register(
      {
        name: "architect",
        description: "user's own architect",
        prompt: distinctivePrompt,
        mode: "subagent",
        skills: [],
      },
      skills
    );

    await runOnboarding(paths, registry, teamManager, store, skillManager);

    const content = await readFile(join(paths.agentsDir, "architect.md"), "utf-8");
    expect(content).toContain(distinctivePrompt);

    // Other default agents should still have been created.
    const files = await readdir(paths.agentsDir);
    expect(files).toContain("quick-fixer.md");
    expect(files).toContain("senior-dev.md");
    expect(files).toContain("qa-engineer.md");
  });

  it("should not overwrite a pre-existing user team that shares a default team's name", async () => {
    await teamManager.createTeam({
      name: "dev-team",
      description: "user's own team",
      coordination: "parallel",
      members: [],
      createdAt: 123,
    });

    await runOnboarding(paths, registry, teamManager, store, skillManager);

    const team = teamManager.getTeam("dev-team");
    expect(team?.description).toBe("user's own team");
    expect(team?.coordination).toBe("parallel");
  });
});
