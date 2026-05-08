// Team Manager - Agent team creation and communication

import type { TeamDefinition, TeamMember } from "../types.js";
import type { MemoryStore } from "../memory/store.js";
import { randomUUID } from "node:crypto";

export interface TeamMessage {
  id: string;
  from: string;
  to: string | "broadcast";
  teamName: string;
  content: string;
  timestamp: number;
  kind: "message" | "task" | "result" | "shutdown_request";
}

export class TeamManager {
  private store: MemoryStore;
  private teams: Map<string, TeamDefinition> = new Map();
  private messageQueue: Map<string, TeamMessage[]> = new Map();

  constructor(store: MemoryStore) {
    this.store = store;
  }

  async init(): Promise<void> {
    const stored = await this.store.list("team");
    for (const mem of stored) {
      try {
        const team = JSON.parse(mem.content) as TeamDefinition;
        this.teams.set(team.name, team);
      } catch {
        // Skip malformed
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
      metadata: {
        memberCount: team.members.length,
        coordination: team.coordination,
      },
    });
  }

  async deleteTeam(name: string): Promise<boolean> {
    this.teams.delete(name);
    this.messageQueue.delete(name);
    return this.store.delete("team", `team-${name}`);
  }

  getTeam(name: string): TeamDefinition | undefined {
    return this.teams.get(name);
  }

  getAllTeams(): TeamDefinition[] {
    return Array.from(this.teams.values());
  }

  /**
   * Send a message between team members
   */
  sendMessage(
    teamName: string,
    from: string,
    to: string | "broadcast",
    content: string,
    kind: TeamMessage["kind"] = "message"
  ): TeamMessage {
    const msg: TeamMessage = {
      id: randomUUID(),
      from,
      to,
      teamName,
      content,
      timestamp: Date.now(),
      kind,
    };

    const queue = this.messageQueue.get(teamName) ?? [];
    queue.push(msg);
    this.messageQueue.set(teamName, queue);

    return msg;
  }

  /**
   * Get pending messages for a team member
   */
  getMessages(teamName: string, memberName: string): TeamMessage[] {
    const queue = this.messageQueue.get(teamName) ?? [];
    return queue.filter(
      (m) => m.to === memberName || m.to === "broadcast"
    );
  }

  /**
   * Get the execution order for a team based on coordination mode
   */
  getExecutionOrder(teamName: string): string[][] {
    const team = this.teams.get(teamName);
    if (!team) return [];

    switch (team.coordination) {
      case "parallel":
        return [team.members.map((m) => m.agentName)];
      case "sequential":
        return team.members.map((m) => [m.agentName]);
      case "adaptive":
        // Adaptive: start with first member, then parallel
        if (team.members.length <= 1) {
          return team.members.map((m) => [m.agentName]);
        }
        return [
          [team.members[0].agentName],
          team.members.slice(1).map((m) => m.agentName),
        ];
    }
  }

  /**
   * Build team coordination context for injection into agent prompts
   */
  buildTeamContext(teamName: string): string {
    const team = this.teams.get(teamName);
    if (!team) return "";

    const members = team.members
      .map((m) => `- **${m.agentName}** (${m.role})`)
      .join("\n");

    return [
      `## Team: ${team.name}`,
      `Description: ${team.description}`,
      `Coordination: ${team.coordination}`,
      `Members:`,
      members,
      `Use \`hera_team_message\` to communicate with teammates.`,
    ].join("\n");
  }
}
