import type { TeamDefinition } from "../types.js";
import type { OpenCodeClient } from "../types/client.js";
import type { MemoryStore } from "../memory/store.js";
import { randomUUID } from "node:crypto";
import { TEAM_POLL_MAX_ATTEMPTS, TEAM_POLL_INTERVAL_MS } from "../constants.js";

export interface TeamMessage {
  id: string;
  from: string;
  to: string | "broadcast";
  teamName: string;
  content: string;
  timestamp: number;
  kind: "message" | "task" | "result" | "shutdown_request";
}

export interface SpawnedSession {
  agentName: string;
  sessionId: string;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
}

export class TeamManager {
  private store: MemoryStore;
  private teams: Map<string, TeamDefinition> = new Map();
  private messageQueue: Map<string, TeamMessage[]> = new Map();
  private spawnedSessions: Map<string, SpawnedSession[]> = new Map();
  private client: OpenCodeClient | undefined;

  constructor(store: MemoryStore, client: OpenCodeClient | undefined) {
    this.store = store;
    this.client = client;
  }

  async init(): Promise<void> {
    const stored = await this.store.list("team");
    for (const mem of stored) {
      try {
        const team = JSON.parse(mem.content) as TeamDefinition;
        this.teams.set(team.name, team);
        this.messageQueue.set(team.name, []);
      } catch {
        // skip
      }
    }
  }

  async createTeam(team: TeamDefinition): Promise<void> {
    this.teams.set(team.name, team);
    this.messageQueue.set(team.name, []);
    await this.store.save({
      id: `team-${team.name}`,
      type: "team",
      content: JSON.stringify(team),
      timestamp: Date.now(),
      metadata: { memberCount: team.members.length, coordination: team.coordination },
    });
  }

  async deleteTeam(name: string): Promise<boolean> {
    this.teams.delete(name);
    this.messageQueue.delete(name);
    this.spawnedSessions.delete(name);
    return this.store.delete("team", `team-${name}`);
  }

  getTeam(name: string): TeamDefinition | undefined {
    return this.teams.get(name);
  }

  getAllTeams(): TeamDefinition[] {
    return Array.from(this.teams.values());
  }

  async spawnTeam(
    teamName: string,
    taskPrompt: string,
    parentSessionId: string,
    directory: string
  ): Promise<SpawnedSession[]> {
    const team = this.teams.get(teamName);
    if (!team) throw new Error(`Team "${teamName}" not found`);

    const sessions: SpawnedSession[] = [];
    const hasClient = this.client && typeof this.client.session?.create === "function";

    switch (team.coordination) {
      case "parallel": {
        const promises = team.members.map(async (member) => {
          const session = await this.spawnMemberSession(member.agentName, taskPrompt, parentSessionId, directory, hasClient);
          sessions.push(session);
        });
        await Promise.all(promises);
        break;
      }
      case "sequential": {
        let accumulated = taskPrompt;
        for (const member of team.members) {
          const session = await this.spawnMemberSession(member.agentName, accumulated, parentSessionId, directory, hasClient);
          if (hasClient) {
            const result = await this.pollSessionCompletion(session.sessionId);
            session.status = "completed";
            session.result = result;
            accumulated = `Previous agent (${member.agentName}) output:\n${result}\n\nContinue with your task based on the above.`;
          }
          sessions.push(session);
        }
        break;
      }
      case "adaptive": {
        if (team.members.length === 0) break;
        const planner = team.members[0];
        const planSession = await this.spawnMemberSession(planner.agentName, taskPrompt, parentSessionId, directory, hasClient);
        let plan = taskPrompt;
        if (hasClient && team.members.length > 1) {
          const planResult = await this.pollSessionCompletion(planSession.sessionId);
          planSession.status = "completed";
          planSession.result = planResult;
          plan = `Plan from ${planner.agentName}:\n${planResult}\n\nExecute your part of this plan.`;
        }
        sessions.push(planSession);
        if (team.members.length > 1) {
          const promises = team.members.slice(1).map(async (member) => {
            const session = await this.spawnMemberSession(member.agentName, plan, parentSessionId, directory, hasClient);
            sessions.push(session);
          });
          await Promise.all(promises);
        }
        break;
      }
    }

    this.spawnedSessions.set(teamName, sessions);
    return sessions;
  }

  private async spawnMemberSession(
    agentName: string,
    prompt: string,
    parentSessionId: string,
    directory: string,
    hasClient: boolean
  ): Promise<SpawnedSession> {
    if (!hasClient) {
      return { agentName, sessionId: `local-${randomUUID().slice(0, 8)}`, status: "pending" };
    }
    try {
      const createResult = await this.client.session.create({
        body: { parentID: parentSessionId, title: `Hera team task → @${agentName}` },
        query: { directory },
      });
      const sessionId = createResult.data?.id ?? createResult.data;
      await this.client.session.promptAsync({
        path: { id: sessionId },
        body: { agent: agentName, parts: [{ type: "text", text: prompt }] },
      });
      return { agentName, sessionId, status: "running" };
    } catch (err: any) {
      return { agentName, sessionId: `error-${randomUUID().slice(0, 8)}`, status: "error", result: err?.message ?? String(err) };
    }
  }

  private async pollSessionCompletion(sessionId: string): Promise<string> {
    const maxAttempts = TEAM_POLL_MAX_ATTEMPTS;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const statusResult = await this.client.session.status({ path: { id: sessionId } });
        const status = statusResult.data?.status;
        if (status === "completed" || status === "idle" || status === "error") {
          const messagesResult = await this.client.session.messages({ path: { id: sessionId } });
          const messages = messagesResult.data ?? [];
          for (let j = messages.length - 1; j >= 0; j--) {
            if (messages[j].role === "assistant") {
              return messages[j].parts?.map((p: any) => p.text ?? "").join("") ?? "";
            }
          }
          return "(no response)";
        }
      } catch {
        // continue
      }
      await new Promise((r) => setTimeout(r, TEAM_POLL_INTERVAL_MS));
    }
    return "(timeout)";
  }

  sendMessage(
    teamName: string,
    from: string,
    to: string | "broadcast",
    content: string,
    kind: TeamMessage["kind"] = "message"
  ): TeamMessage {
    const msg: TeamMessage = { id: randomUUID(), from, to, teamName, content, timestamp: Date.now(), kind };
    const queue = this.messageQueue.get(teamName) ?? [];
    queue.push(msg);
    this.messageQueue.set(teamName, queue);
    return msg;
  }

  getMessages(teamName: string, memberName: string): TeamMessage[] {
    const queue = this.messageQueue.get(teamName) ?? [];
    return queue.filter((m) => m.to === memberName || m.to === "broadcast");
  }

  buildTeamContext(teamName: string): string {
    const team = this.teams.get(teamName);
    if (!team) return "";
    const members = team.members.map((m) => `- **${m.agentName}** (${m.role})`).join("\n");
    const sessions = this.spawnedSessions.get(teamName) ?? [];
    const sessionInfo = sessions.length > 0
      ? `\nActive Sessions:\n${sessions.map((s) => `- ${s.agentName}: ${s.status} (${s.sessionId})`).join("\n")}`
      : "";
    return [
      `## Team: ${team.name}`,
      `Description: ${team.description}`,
      `Coordination: ${team.coordination}`,
      `Members:`,
      members,
      sessionInfo,
    ].join("\n");
  }
}
