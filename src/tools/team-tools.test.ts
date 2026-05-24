import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTeamTools } from "./team-tools.js";
import { createAgentTools } from "./agent-tools.js";
import { makeTestHarness, type TestHarness } from "./test-harness.js";
import { TeamManager } from "../team/manager.js";

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

    it("stores an editable workflow recipe when provided", async () => {
      await makeAgent("architect");

      await teamTools.hera_create_team.execute(
        {
          name: "recipe-team",
          description: "Recipe team",
          coordination: "sequential",
          workflow: {
            id: "recipe-team-workflow",
            name: "Recipe Team Workflow",
            description: "Recipe test",
            mode: "recipe",
            steps: [
              { type: "agent", title: "Plan work", actor: "architect" },
              { type: "approval", title: "Review result" },
            ],
          },
          members: [{ agent_name: "architect", role: "architect" }],
        } as any,
        {} as any
      );

      const team = harness.ctx.teamManager.getTeam("recipe-team");
      expect(team?.workflow?.name).toBe("Recipe Team Workflow");
      expect(team?.workflow?.steps[0].id).toBe("step-1");
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

  describe("workflow recipes", () => {
    it("sets and previews a team workflow recipe", async () => {
      await makeAgent("architect");
      await teamTools.hera_create_team.execute(
        {
          name: "workflow-team",
          description: "Workflow test",
          coordination: "parallel",
          members: [{ agent_name: "architect", role: "architect" }],
        } as any,
        {} as any
      );

      const preview = await teamTools.hera_preview_team_workflow.execute(
        {
          workflow: {
            id: "preview-workflow",
            name: "Preview Workflow",
            mode: "recipe",
            steps: [{ type: "agent", title: "Plan" }],
          },
        } as any,
        {} as any
      );
      expect(String(preview)).toContain('Recipe "Preview Workflow" (preview-workflow)');

      const updated = await teamTools.hera_set_team_workflow.execute(
        {
          team_name: "workflow-team",
          workflow: {
            id: "workflow-team-workflow",
            name: "Workflow Team Recipe",
            description: "Updated recipe",
            mode: "recipe",
            steps: [
              { type: "agent", title: "Plan", actor: "architect" },
              { type: "approval", title: "Approve" },
            ],
          },
        } as any,
        {} as any
      );

      expect(String(updated)).toContain('Workflow recipe set for team "workflow-team"');
      expect(String(updated)).toContain("Workflow Team Recipe");
      const team = harness.ctx.teamManager.getTeam("workflow-team");
      expect(team?.workflow?.name).toBe("Workflow Team Recipe");
      expect(team?.workflow?.steps).toHaveLength(2);
    });

    it("rejects workflow updates for missing teams", async () => {
      const result = await teamTools.hera_set_team_workflow.execute(
        {
          team_name: "missing-team",
          workflow: {
            id: "missing-team-workflow",
            name: "Missing Team Recipe",
            mode: "recipe",
            steps: [{ type: "agent", title: "Plan" }],
          },
        } as any,
        {} as any
      );

      expect(String(result)).toContain("not found");
    });
  });

  describe("hera_upgrade_agents_to_team", () => {
    it("creates a team from existing agents with inferred roles", async () => {
      await makeAgent("alpha");
      await makeAgent("beta");

      const result = await teamTools.hera_upgrade_agents_to_team.execute(
        {
          name: "upgraded-team",
          description: "Agents upgraded to team",
          coordination: "parallel",
          agent_names: ["alpha", "beta"],
        } as any,
        {} as any
      );

      expect(String(result)).toContain("upgraded-team");
      const team = harness.ctx.teamManager.getTeam("upgraded-team");
      expect(team).toBeDefined();
      expect(team!.members.map((m) => m.agentName)).toEqual(["alpha", "beta"]);
    });

    it("supports management mode without writing stale static team prompts", async () => {
      await makeAgent("alpha", "all");
      await makeAgent("beta", "all");

      const result = await teamTools.hera_upgrade_agents_to_team.execute(
        {
          name: "managed-team",
          description: "Managed team",
          coordination: "sequential",
          management: "okr",
          member_mode: "subagent",
          agent_names: ["alpha", "beta"],
        } as any,
        {} as any
      );

      expect(String(result)).toContain("managed-team");
      expect(String(result)).toContain("okr");
      const team = harness.ctx.teamManager.getTeam("managed-team");
      expect(team!.management).toBe("okr");
      const alpha = harness.ctx.registeredAgents.get("alpha");
      expect(alpha!.mode).toBe("subagent");
      expect(alpha!.prompt).not.toContain("## Hera Team Awareness");
      expect(harness.ctx.teamManager.getAgentTeamContext("alpha")).toContain(
        "hera_ack_team_messages"
      );
      expect(harness.ctx.teamManager.getAgentTeamContext("alpha")).toContain("team blackboard");
    });

    it("removes legacy static team awareness blocks when deleting a team", async () => {
      await makeAgent("legacy", "all");
      const legacy = harness.ctx.registeredAgents.get("legacy")!;
      harness.ctx.registeredAgents.set("legacy", {
        ...legacy,
        prompt: `${legacy.prompt}\n\n## Hera Team Awareness\nOld static team block.`,
      });
      await teamTools.hera_create_team.execute(
        {
          name: "legacy-team",
          description: "Legacy team",
          coordination: "parallel",
          members: [{ agent_name: "legacy", role: "member" }],
        } as any,
        {} as any
      );

      const result = await teamTools.hera_delete_team.execute(
        { name: "legacy-team" } as any,
        {} as any
      );

      expect(String(result)).toContain("Legacy static team prompt blocks were removed");
      expect(harness.ctx.registeredAgents.get("legacy")!.prompt).not.toContain(
        "## Hera Team Awareness"
      );
    });

    it("rejects missing agents", async () => {
      const result = await teamTools.hera_upgrade_agents_to_team.execute(
        {
          name: "broken-upgrade",
          description: "Broken",
          coordination: "parallel",
          agent_names: ["ghost"],
        } as any,
        {} as any
      );

      expect(String(result)).toContain("Error");
      expect(harness.ctx.teamManager.getTeam("broken-upgrade")).toBeUndefined();
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
      expect(String(listed)).toContain("parallel, simple");

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
      expect(String(result)).toContain("flat team");
      expect(String(result)).toContain("Shared workspace");
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

  describe("team messages", () => {
    it("sends, retrieves, and persists team messages", async () => {
      await makeAgent("sender");
      await makeAgent("receiver");
      await teamTools.hera_create_team.execute(
        {
          name: "message-team",
          description: "Message test",
          coordination: "parallel",
          members: [
            { agent_name: "sender", role: "sender" },
            { agent_name: "receiver", role: "receiver" },
          ],
        } as any,
        {} as any
      );

      await teamTools.hera_team_message.execute(
        {
          team_name: "message-team",
          from: "sender",
          to: "receiver",
          content: "please review this",
          kind: "task",
        } as any,
        {} as any
      );

      const messages = await teamTools.hera_get_team_messages.execute(
        { team_name: "message-team", member_name: "receiver" } as any,
        {} as any
      );
      expect(String(messages)).toContain("please review this");

      const reloadedManager = new TeamManager(harness.ctx.store, undefined);
      await reloadedManager.init();
      const reloaded = reloadedManager.getMessages("message-team", "receiver");
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].content).toBe("please review this");
    });

    it("best-effort pushes messages to active member sessions", async () => {
      await makeAgent("sender");
      await makeAgent("receiver");
      const pushed: string[] = [];
      const fakeClient = {
        session: {
          create: async () => ({ data: { id: "session-receiver" } }),
          promptAsync: async (input: {
            path: { id: string };
            body: { parts: { text: string }[] };
          }) => {
            pushed.push(`${input.path.id}:${input.body.parts[0].text}`);
            return { data: {} };
          },
        },
      };
      harness.ctx.teamManager = new TeamManager(
        harness.ctx.store,
        fakeClient as unknown as ConstructorParameters<typeof TeamManager>[1]
      );
      await harness.ctx.teamManager.init();
      teamTools = createTeamTools(harness.ctx);

      await teamTools.hera_create_team.execute(
        {
          name: "push-team",
          description: "Push test",
          coordination: "parallel",
          members: [
            { agent_name: "sender", role: "sender" },
            { agent_name: "receiver", role: "receiver" },
          ],
        } as any,
        {} as any
      );
      await teamTools.hera_spawn_team.execute(
        { team_name: "push-team", task_prompt: "Start" } as any,
        { sessionID: "parent", directory: harness.tmp } as any
      );
      await teamTools.hera_team_message.execute(
        {
          team_name: "push-team",
          from: "sender",
          to: "receiver",
          content: "active message",
          kind: "message",
        } as any,
        {} as any
      );

      expect(pushed.some((entry) => entry.includes("active message"))).toBe(true);
    });

    it("acknowledges visible team messages and persists ack state", async () => {
      await makeAgent("sender");
      await makeAgent("receiver");
      await teamTools.hera_create_team.execute(
        {
          name: "ack-team",
          description: "Ack test",
          coordination: "parallel",
          members: [
            { agent_name: "sender", role: "sender" },
            { agent_name: "receiver", role: "receiver" },
          ],
        } as any,
        {} as any
      );
      const sent = await teamTools.hera_team_message.execute(
        {
          team_name: "ack-team",
          from: "sender",
          to: "receiver",
          content: "please ack this",
        } as any,
        {} as any
      );
      const messageId = String(sent).match(/ID: ([0-9a-f-]+)/)?.[1];
      expect(messageId).toBeDefined();

      const ack = await teamTools.hera_ack_team_messages.execute(
        { team_name: "ack-team", member_name: "receiver", message_ids: [messageId] } as any,
        {} as any
      );
      expect(String(ack)).toContain("Acknowledged 1");
      const messages = await teamTools.hera_get_team_messages.execute(
        { team_name: "ack-team", member_name: "receiver" } as any,
        {} as any
      );
      expect(String(messages)).toContain("ack:receiver");

      const reloadedManager = new TeamManager(harness.ctx.store, undefined);
      await reloadedManager.init();
      expect(reloadedManager.getMessages("ack-team", "receiver")[0].acknowledgedBy).toContain(
        "receiver"
      );
    });
  });

  describe("team memory", () => {
    it("stores and recalls team-scoped memory", async () => {
      await makeAgent("memory-agent");
      await teamTools.hera_create_team.execute(
        {
          name: "memory-team",
          description: "Memory test",
          coordination: "parallel",
          members: [{ agent_name: "memory-agent", role: "member" }],
        } as any,
        {} as any
      );

      const remembered = await teamTools.hera_team_remember.execute(
        {
          team_name: "memory-team",
          key: "style",
          content: "Use strict TypeScript.",
          written_by: "memory-agent",
        } as any,
        {} as any
      );
      expect(String(remembered)).toContain("shared workspace");
      const recalled = await teamTools.hera_team_recall.execute(
        { team_name: "memory-team", query: "strict TypeScript" } as any,
        {} as any
      );

      expect(String(recalled)).toContain("Team workspace for memory-team");
      expect(String(recalled)).toContain("strict TypeScript");
    });

    it("stores team memory when team names or keys contain path separators", async () => {
      await makeAgent("memory-agent");
      await teamTools.hera_create_team.execute(
        {
          name: "team/with/slash",
          description: "Memory path safety test",
          coordination: "parallel",
          members: [{ agent_name: "memory-agent", role: "member" }],
        } as any,
        {} as any
      );

      const remembered = await teamTools.hera_team_remember.execute(
        {
          team_name: "team/with/slash",
          key: "nested/key",
          content: "Keep unsafe path characters out of filenames.",
        } as any,
        {} as any
      );
      const recalled = await teamTools.hera_team_recall.execute(
        { team_name: "team/with/slash", query: "unsafe path" } as any,
        {} as any
      );

      expect(String(remembered)).toContain("shared workspace");
      expect(String(recalled)).toContain("unsafe path characters");
    });
  });

  describe("team sessions", () => {
    it("shows spawned local sessions in team progress", async () => {
      await makeAgent("runner");
      await teamTools.hera_create_team.execute(
        {
          name: "session-team",
          description: "Session test",
          coordination: "parallel",
          members: [{ agent_name: "runner", role: "runner" }],
        } as any,
        {} as any
      );

      await teamTools.hera_spawn_team.execute(
        { team_name: "session-team", task_prompt: "Run smoke task" } as any,
        { sessionID: "parent", directory: harness.tmp } as any
      );
      const progress = await teamTools.hera_get_team_progress.execute(
        { team_name: "session-team" } as any,
        {} as any
      );

      expect(String(progress)).toContain("## Sessions");
      expect(String(progress)).toContain("runner");
    });

    it("marks restored non-terminal sessions as unknown", async () => {
      await makeAgent("runner");
      await teamTools.hera_create_team.execute(
        {
          name: "restored-session-team",
          description: "Session restore test",
          coordination: "parallel",
          members: [{ agent_name: "runner", role: "runner" }],
        } as any,
        {} as any
      );
      await teamTools.hera_spawn_team.execute(
        { team_name: "restored-session-team", task_prompt: "Run smoke task" } as any,
        { sessionID: "parent", directory: harness.tmp } as any
      );

      const reloadedManager = new TeamManager(harness.ctx.store, undefined);
      await reloadedManager.init();
      const sessions = reloadedManager.getSpawnedSessions("restored-session-team");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe("unknown");
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
