import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  memberAgentNameForSkill,
  inferRoleFromSkill,
  upgradeSkillsToTeam,
} from "./skill-to-team.js";
import { AgentRegistry } from "../agents/registry.js";
import { TeamManager } from "../team/manager.js";
import { MemoryStore } from "../memory/store.js";
import { SkillManager } from "../skills/manager.js";
import type { AgentDefinition } from "../types.js";

describe("memberAgentNameForSkill", () => {
  it("combines team + skill into a unique name", () => {
    expect(memberAgentNameForSkill("review-squad", "security")).toBe("review-squad-security");
    expect(memberAgentNameForSkill("dev", "code")).toBe("dev-code");
  });

  it("collapses repeated hyphens", () => {
    expect(memberAgentNameForSkill("team-a", "skill-b")).toBe("team-a-skill-b");
  });
});

describe("inferRoleFromSkill", () => {
  it("maps known skill names to friendly roles", () => {
    expect(inferRoleFromSkill("security")).toContain("security");
    expect(inferRoleFromSkill("research")).toContain("research");
    expect(inferRoleFromSkill("review")).toContain("review");
  });

  it("falls back to using the skill name itself as the role", () => {
    expect(inferRoleFromSkill("my-custom-skill")).toContain("my-custom-skill");
  });
});

describe("upgradeSkillsToTeam (integration)", () => {
  let tmp: string;
  let agentRegistry: AgentRegistry;
  let teamManager: TeamManager;
  let store: MemoryStore;
  let skillManager: SkillManager;
  let registeredAgents: Map<string, AgentDefinition>;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-skill-team-"));
    await mkdir(join(tmp, "hera-data"), { recursive: true });

    agentRegistry = new AgentRegistry(join(tmp, "agents", "hera"));
    await agentRegistry.init();
    store = new MemoryStore(join(tmp, "hera-data", "memory"));
    await store.init();
    skillManager = new SkillManager(store, join(tmp, "hera-data", "skills"));
    await skillManager.init();
    teamManager = new TeamManager(store, undefined);
    await teamManager.init();

    // Add 2 user skills to upgrade
    await skillManager.createSkill({
      name: "security",
      description: "security review skill",
      trigger: "always",
      prompt: "Audit code for security issues.",
      category: "user",
    });
    await skillManager.createSkill({
      name: "perf",
      description: "performance audit skill",
      trigger: "always",
      prompt: "Audit code for performance issues.",
      category: "user",
    });

    registeredAgents = new Map();
  });

  afterEach(async () => {
    try { await rm(tmp, { recursive: true }); } catch {}
  });

  it("creates one agent per skill and registers the team", async () => {
    const result = await upgradeSkillsToTeam({
      skillNames: ["security", "perf"],
      teamName: "audit-team",
      description: "Security + perf audit team",
      coordination: "parallel",
      skillManager,
      teamManager,
      agentRegistry,
      store,
      registeredAgents,
    });

    expect(result.ok).toBe(true);
    expect(result.createdAgents).toEqual(["audit-team-security", "audit-team-perf"]);

    // Each member agent is persisted and registered in-memory
    for (const name of result.createdAgents) {
      expect(registeredAgents.has(name)).toBe(true);
    }

    // Team exists with 2 members
    const team = teamManager.getTeam("audit-team");
    expect(team).toBeDefined();
    expect(team!.members).toHaveLength(2);
    expect(team!.coordination).toBe("parallel");
    expect(team!.members.map((m) => m.agentName).sort()).toEqual(
      ["audit-team-perf", "audit-team-security"]
    );
  });

  it("fails if any skill is missing — does not create partial team", async () => {
    const result = await upgradeSkillsToTeam({
      skillNames: ["security", "nonexistent-skill"],
      teamName: "broken-team",
      description: "test",
      coordination: "sequential",
      skillManager,
      teamManager,
      agentRegistry,
      store,
      registeredAgents,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("nonexistent-skill");
    expect(teamManager.getTeam("broken-team")).toBeUndefined();
    expect(registeredAgents.size).toBe(0);
  });

  it("rejects empty skill list", async () => {
    const result = await upgradeSkillsToTeam({
      skillNames: [],
      teamName: "empty",
      description: "test",
      coordination: "parallel",
      skillManager,
      teamManager,
      agentRegistry,
      store,
      registeredAgents,
    });
    expect(result.ok).toBe(false);
  });
});
