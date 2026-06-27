import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createSkillTools } from "./skill-tools.js";
import { makeTestHarness, type TestHarness } from "./test-harness.js";

describe("createSkillTools (integration)", () => {
  let harness: TestHarness;
  let skillTools: ReturnType<typeof createSkillTools>;

  beforeEach(async () => {
    harness = await makeTestHarness();
    skillTools = createSkillTools(harness.ctx);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("previews skill-to-agent upgrades without persisting", async () => {
    const execute = skillTools.hera_upgrade_to_agent.execute as (
      args: {
        agent_name: string;
        description: string;
        skill_names: string[];
        dry_run: boolean;
      },
      ctx: unknown
    ) => Promise<unknown>;

    const result = await execute(
      {
        agent_name: "memory-specialist",
        description: "Memory specialist",
        skill_names: ["memory"],
        dry_run: true,
      },
      {}
    );

    expect(String(result)).toContain("Preview: skill upgrade to agent");
    expect(String(result)).toContain("already inherited");
    expect(harness.ctx.registeredAgents.has("memory-specialist")).toBe(false);
  });

  it("hera_load_skill returns the full body for a known skill", async () => {
    const execute = skillTools.hera_load_skill.execute as (
      args: { name: string },
      ctx: unknown
    ) => Promise<unknown>;
    const result = String(await execute({ name: "caveman" }, {}));
    expect(result).toContain("## Skill: caveman");
    // The full body is far longer than a one-line manifest description.
    expect(result.length).toBeGreaterThan(80);
  });

  it("hera_load_skill returns an error for an unknown skill", async () => {
    const execute = skillTools.hera_load_skill.execute as (
      args: { name: string },
      ctx: unknown
    ) => Promise<unknown>;
    const result = String(await execute({ name: "no-such-skill" }, {}));
    expect(result).toContain("not found");
  });

  it("hera_load_skill rejects an invalid skill name", async () => {
    const execute = skillTools.hera_load_skill.execute as (
      args: { name: string },
      ctx: unknown
    ) => Promise<unknown>;
    const result = String(await execute({ name: "../escape" }, {}));
    expect(result.startsWith("Error")).toBe(true);
  });

  it("previews skill-to-team upgrades without persisting", async () => {
    const execute = skillTools.hera_upgrade_to_team.execute as (
      args: {
        team_name: string;
        description: string;
        skill_names: string[];
        coordination: "parallel" | "sequential" | "adaptive";
        management: "simple" | "okr" | "tree" | "control";
        dry_run: boolean;
      },
      ctx: unknown
    ) => Promise<unknown>;

    const result = await execute(
      {
        team_name: "preview-skill-team",
        description: "Preview team",
        skill_names: ["memory"],
        coordination: "parallel",
        management: "control",
        dry_run: true,
      },
      {}
    );

    expect(String(result)).toContain("Preview only");
    expect(String(result)).toContain("preview-skill-team-memory");
    expect(String(result)).toContain("already inherited");
    expect(harness.ctx.teamManager.getTeam("preview-skill-team")).toBeUndefined();
  });
});
