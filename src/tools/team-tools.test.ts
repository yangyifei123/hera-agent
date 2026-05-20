import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTeamTools } from "./team-tools.js";
import { createAgentTools } from "./agent-tools.js";
import { makeTestHarness, type TestHarness } from "./test-harness.js";

describe("createTeamTools (integration)", () => {
  let harness: TestHarness;
  let teamTools: ReturnType<typeof createTeamTools>;
  let agentTools: ReturnType<typeof createAgentTools>;

  beforeEach(async () => {
    harness = await makeTestHarness();
    teamTools = createTeamTools(harness.ctx);
    agentTools = createAgentTools(harness.ctx);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  async function makeAgent(name: string, mode: "primary" | "subagent" | "all" = "subagent") {
    await agentTools.hera_create_agent.execute(
      {
        name,
        description: `${name} agent`,
        prompt: `You are ${name}.`,
        mode,
      } as any,
      {} as any
    );
  }

  describe("hera_create_team", () => {
    it("creates a team referencing pre-existing member agents", async () => {
      await makeAgent("architect");
      await makeAgent("coder");
      const result = await teamTools.hera_create_team.execute(
        {
          name: "design-team",
          description: "Architecture team",
          coordination: "sequential",
          members: [
            { agent_name: "architect", role: "architect" },
            { agent_name: "coder", role: "developer" },
          ],
        } as any,
        {} as any
      );
      expect(String(result)).toContain("design-team");
      const team = harness.ctx.teamManager.getTeam("design-team");
      expect(team).toBeDefined();
      expect(team!.members).toHaveLength(2);
    });

    it("rejects teams referencing missing members", async () => {
      const result = await teamTools.hera_create_team.execute(
        {
          name: "broken",
          description: "x",
          coordination: "parallel",
          members: [{ agent_name: "ghost", role: "x" }],
        } as any,
        {} as any
      );
      expect(String(result)).toContain("Error");
      expect(String(result)).toContain("ghost");
      expect(harness.ctx.teamManager.getTeam("broken")).toBeUndefined();
    });
  });

  describe("hera_list_teams + hera_delete_team", () => {
    it("lists empty, then created, then deleted", async () => {
      const empty = await teamTools.hera_list_teams.execute({} as any, {} as any);
      expect(String(empty)).toContain("No teams");

      await makeAgent("alpha");
      await teamTools.hera_create_team.execute(
        {
          name: "solo-team",
          description: "x",
          coordination: "parallel",
          members: [{ agent_name: "alpha", role: "lead" }],
        } as any,
        {} as any
      );
      const listed = await teamTools.hera_list_teams.execute({} as any, {} as any);
      expect(String(listed)).toContain("solo-team");

      await teamTools.hera_delete_team.execute({ name: "solo-team" } as any, {} as any);
      const after = await teamTools.hera_list_teams.execute({} as any, {} as any);
      expect(String(after)).toContain("No teams");
    });

    it("hera_delete_team returns error for unknown team", async () => {
      const result = await teamTools.hera_delete_team.execute(
        { name: "no-such" } as any,
        {} as any
      );
      expect(String(result)).toContain("not found");
    });
  });

  describe("hera_get_team_progress", () => {
    it("returns team info for an existing team", async () => {
      await makeAgent("planner");
      await teamTools.hera_create_team.execute(
        {
          name: "info-team",
          description: "Info test",
          coordination: "adaptive",
          members: [{ agent_name: "planner", role: "planner" }],
        } as any,
        {} as any
      );
      const result = await teamTools.hera_get_team_progress.execute(
        { team_name: "info-team" } as any,
        {} as any
      );
      expect(String(result)).toContain("info-team");
      expect(String(result)).toContain("adaptive");
      expect(String(result)).toContain("planner");
    });

    it("returns error for unknown team", async () => {
      const result = await teamTools.hera_get_team_progress.execute(
        { team_name: "ghost-team" } as any,
        {} as any
      );
      expect(String(result)).toContain("not found");
    });
  });

  describe("hera_export_team", () => {
    it("exports an existing team as a plugin package", async () => {
      await makeAgent("alpha");
      await makeAgent("beta");
      await teamTools.hera_create_team.execute(
        {
          name: "export-team",
          description: "Export test",
          coordination: "parallel",
          members: [
            { agent_name: "alpha", role: "lead" },
            { agent_name: "beta", role: "worker" },
          ],
        } as any,
        {} as any
      );

      const result = await teamTools.hera_export_team.execute(
        {
          team_name: "export-team",
        } as any,
        {} as any
      );
      expect(String(result)).toContain("exported");

      const pluginDir = join(
        harness.ctx.paths.configRoot,
        "agents",
        "hera-generated",
        "export-team-team"
      );
      const files = await readdir(pluginDir);
      expect(files).toContain("package.json");
      expect(files).toContain("src");

      const idx = await readFile(join(pluginDir, "src", "index.ts"), "utf-8");
      expect(idx).toContain('input.agent["alpha"]');
      expect(idx).toContain('input.agent["beta"]');
      expect(idx).toContain("Team Context");
    });

    it("rejects export of unknown team", async () => {
      const result = await teamTools.hera_export_team.execute(
        { team_name: "ghost" } as any,
        {} as any
      );
      expect(String(result)).toContain("not found");
    });
  });
});
