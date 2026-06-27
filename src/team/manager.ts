import type { TeamDefinition } from "../types.js";
import type { OpenCodeClient } from "../types/client.js";
import type { MemoryStore } from "../memory/store.js";
import { randomUUID } from "node:crypto";
import {
  TEAM_MANAGEMENT_DESCRIPTIONS,
  TEAM_MESSAGE_QUEUE_CAP,
  TEAM_MESSAGE_TTL_MS,
  TEAM_POLL_MAX_ATTEMPTS,
  TEAM_POLL_INTERVAL_MS,
} from "../constants.js";
import { errorMessage } from "../helpers.js";
import { summarizeTeamWorkflowRecipe } from "./workflow-recipe.js";

export interface TeamMessage {
  id: string;
  from: string;
  to: string | "broadcast";
  teamName: string;
  content: string;
  timestamp: number;
  kind: "message" | "task" | "result" | "shutdown_request";
  acknowledgedBy?: string[];
  acknowledgedAt?: Record<string, number>;
}

export interface SpawnedSession {
  agentName: string;
  sessionId: string;
  status: "pending" | "running" | "completed" | "error" | "unknown";
  result?: string;
}

/**
 * Discriminated outcome of polling a spawned session for completion.
 * Only `completed` carries a real assistant result that may be forwarded
 * downstream; every other status signals the chain should abort rather than
 * treat the sentinel text as a genuine prior-agent output.
 */
export interface PollResult {
  status: "completed" | "timeout" | "error" | "no-client";
  text: string;
}

/**
 * Upper bound on how many spawned-session records we retain per team across
 * re-spawns. Prior in-flight sessions are merged into newer runs so they stay
 * reachable for recovery; this cap keeps the merged list from growing without
 * bound. Defined locally to avoid editing the shared constants module.
 */
const TEAM_MAX_TRACKED_SESSIONS = 200;

function pollStatusToSessionStatus(status: PollResult["status"]): SpawnedSession["status"] {
  // A hard `error` is terminal; `timeout`/`no-client` leave the session in an
  // indeterminate state where it may still be alive, so mark it `unknown` so
  // recoverSessions can reconcile it later.
  return status === "error" ? "error" : "unknown";
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
    const storedMessages = await this.store.list("team-message");
    for (const mem of storedMessages) {
      try {
        const msg = JSON.parse(mem.content) as TeamMessage;
        msg.acknowledgedBy = msg.acknowledgedBy ?? [];
        msg.acknowledgedAt = msg.acknowledgedAt ?? {};
        const queue = this.messageQueue.get(msg.teamName) ?? [];
        queue.push(msg);
        this.messageQueue.set(msg.teamName, queue);
      } catch {
        // skip malformed messages
      }
    }
    await this.pruneAllMessageQueues();

    const storedSessions = await this.store.list("team-session");
    for (const mem of storedSessions) {
      try {
        const parsed = JSON.parse(mem.content) as { teamName: string; sessions: SpawnedSession[] };
        this.spawnedSessions.set(
          parsed.teamName,
          parsed.sessions.map((session) => ({
            ...session,
            status:
              session.status === "running" || session.status === "pending"
                ? "unknown"
                : session.status,
          }))
        );
      } catch {
        // skip malformed sessions
      }
    }
  }

  async createTeam(team: TeamDefinition): Promise<void> {
    const existingQueue = this.messageQueue.get(team.name);
    const existingSessions = this.spawnedSessions.get(team.name);
    this.teams.set(team.name, team);
    if (existingQueue) this.messageQueue.set(team.name, existingQueue);
    else this.messageQueue.set(team.name, []);
    if (existingSessions) this.spawnedSessions.set(team.name, existingSessions);
    await this.store.save({
      id: teamMemoryId(team.name),
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
    return this.store.delete("team", teamMemoryId(name));
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

    const workflowSummary = team.workflow ? summarizeTeamWorkflowRecipe(team.workflow) : "";
    const promptPrefix = workflowSummary
      ? `## Team Workflow Recipe\n${workflowSummary}\n\nFollow this recipe as the team operates.\n\n`
      : "";
    const effectivePrompt = `${promptPrefix}${taskPrompt}`;

    const sessions: SpawnedSession[] = [];
    const hasClient = Boolean(this.client && typeof this.client.session?.create === "function");

    switch (team.coordination) {
      case "parallel": {
        const promises = team.members.map(async (member) => {
          const session = await this.spawnMemberSession(
            member.agentName,
            effectivePrompt,
            parentSessionId,
            directory,
            hasClient
          );
          sessions.push(session);
        });
        await Promise.all(promises);
        break;
      }
      case "sequential": {
        let accumulated = taskPrompt;
        for (const member of team.members) {
          const session = await this.spawnMemberSession(
            member.agentName,
            `${promptPrefix}${accumulated}`,
            parentSessionId,
            directory,
            hasClient
          );
          if (hasClient) {
            const result = await this.pollSessionCompletion(session.sessionId);
            if (result.status !== "completed") {
              // Upstream produced no genuine output. Do NOT forward the sentinel
              // text downstream (which would poison the next member); surface the
              // failure on this session and abort the rest of the chain.
              session.status = pollStatusToSessionStatus(result.status);
              session.result = `Chain aborted: upstream @${member.agentName} produced no output (${result.status}).`;
              sessions.push(session);
              break;
            }
            session.status = "completed";
            session.result = result.text;
            accumulated = `Previous agent (${member.agentName}) output:\n${result.text}\n\nContinue with your task based on the above.`;
          }
          sessions.push(session);
        }
        break;
      }
      case "adaptive": {
        if (team.members.length === 0) break;
        const planner = team.members[0];
        const planSession = await this.spawnMemberSession(
          planner.agentName,
          effectivePrompt,
          parentSessionId,
          directory,
          hasClient
        );
        let plan = taskPrompt;
        let planReady = true;
        if (hasClient && team.members.length > 1) {
          const planResult = await this.pollSessionCompletion(planSession.sessionId);
          if (planResult.status === "completed") {
            planSession.status = "completed";
            planSession.result = planResult.text;
            plan = `Plan from ${planner.agentName}:\n${planResult.text}\n\nExecute your part of this plan.`;
          } else {
            // The planner produced no genuine plan. Do NOT fan out the sentinel
            // text to executors; surface the failure and skip downstream spawns.
            planSession.status = pollStatusToSessionStatus(planResult.status);
            planSession.result = `Plan aborted: planner @${planner.agentName} produced no plan (${planResult.status}).`;
            planReady = false;
          }
        }
        sessions.push(planSession);
        if (planReady && team.members.length > 1) {
          const promises = team.members.slice(1).map(async (member) => {
            const session = await this.spawnMemberSession(
              member.agentName,
              `${promptPrefix}${plan}`,
              parentSessionId,
              directory,
              hasClient
            );
            sessions.push(session);
          });
          await Promise.all(promises);
        }
        break;
      }
    }

    const reconciled = this.reconcileSpawnedSessions(teamName, sessions);
    this.spawnedSessions.set(teamName, reconciled);
    await this.store.save({
      id: teamSessionMemoryId(teamName),
      type: "team-session",
      content: JSON.stringify({ teamName, sessions: reconciled }),
      timestamp: Date.now(),
      metadata: { sessionCount: reconciled.length },
    });
    return sessions;
  }

  /**
   * Merge a freshly spawned batch with any still in-flight sessions from prior
   * runs so re-spawning a team does not orphan earlier live sessions. Prior
   * sessions that already reached a terminal state (completed/error) are
   * dropped; non-terminal ones are retained ahead of the new batch. Records are
   * deduplicated by sessionId (the new batch wins) and bounded to avoid
   * unbounded growth across many re-spawns.
   */
  private reconcileSpawnedSessions(teamName: string, fresh: SpawnedSession[]): SpawnedSession[] {
    const prior = this.spawnedSessions.get(teamName) ?? [];
    const inFlightPrior = prior.filter(
      (session) =>
        session.status === "running" || session.status === "pending" || session.status === "unknown"
    );
    const bySession = new Map<string, SpawnedSession>();
    for (const session of inFlightPrior) bySession.set(session.sessionId, session);
    // New batch takes precedence on sessionId collisions.
    for (const session of fresh) bySession.set(session.sessionId, session);
    const merged = Array.from(bySession.values());
    return merged.length > TEAM_MAX_TRACKED_SESSIONS
      ? merged.slice(merged.length - TEAM_MAX_TRACKED_SESSIONS)
      : merged;
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
      if (!this.client) {
        return { agentName, sessionId: `local-${randomUUID().slice(0, 8)}`, status: "pending" };
      }

      const createResult = await this.client.session.create({
        body: { parentID: parentSessionId, title: `Hera team task → @${agentName}` },
        query: { directory },
      });
      if (createResult.error || !createResult.data) {
        throw new Error(`Session creation failed for @${agentName}`);
      }
      const sessionId = createResult.data.id;
      await this.client.session.promptAsync({
        path: { id: sessionId },
        body: { agent: agentName, parts: [{ type: "text" as const, text: prompt }] },
      });
      return { agentName, sessionId, status: "running" };
    } catch (err: unknown) {
      return {
        agentName,
        sessionId: `error-${randomUUID().slice(0, 8)}`,
        status: "error",
        result: errorMessage(err),
      };
    }
  }

  private async pollSessionCompletion(sessionId: string): Promise<PollResult> {
    const maxAttempts = TEAM_POLL_MAX_ATTEMPTS;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        if (!this.client) return { status: "no-client", text: "" };
        const statusResult = await this.client.session.status();
        const status = statusResult.data?.[sessionId]?.type;
        if (status === "idle") {
          const messagesResult = await this.client.session.messages({ path: { id: sessionId } });
          const messages = messagesResult.data ?? [];
          for (let j = messages.length - 1; j >= 0; j--) {
            const message = messages[j];
            if (message?.info.role === "assistant") {
              const text = message.parts?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
              return { status: "completed", text };
            }
          }
          // Idle but no assistant message: not a genuine completion.
          return { status: "error", text: "" };
        }
      } catch {
        // continue
      }
      await new Promise((r) => setTimeout(r, TEAM_POLL_INTERVAL_MS));
    }
    return { status: "timeout", text: "" };
  }

  async sendMessage(
    teamName: string,
    from: string,
    to: string | "broadcast",
    content: string,
    kind: TeamMessage["kind"] = "message"
  ): Promise<TeamMessage> {
    const msg: TeamMessage = {
      id: randomUUID(),
      from,
      to,
      teamName,
      content,
      timestamp: Date.now(),
      kind,
      acknowledgedBy: [],
      acknowledgedAt: {},
    };
    const queue = this.messageQueue.get(teamName) ?? [];
    queue.push(msg);
    const pruned = this.pruneMessageQueue(queue);
    this.messageQueue.set(teamName, queue);
    await this.deleteStoredMessages(pruned);
    await this.store.save({
      id: `team-message-${msg.id}`,
      type: "team-message",
      content: JSON.stringify(msg),
      timestamp: msg.timestamp,
      metadata: { teamName, from, to, kind },
    });
    await this.pushMessageToActiveSessions(msg);
    return msg;
  }

  /**
   * A message is "protected" while a required recipient has not yet
   * acknowledged it. Directed messages (to a specific member) require that
   * member's acknowledgement; broadcasts have no single required recipient and
   * are therefore always eligible for eviction under FIFO/TTL pressure.
   */
  private isMessageProtected(message: TeamMessage): boolean {
    if (message.to === "broadcast") return false;
    const acknowledged = message.acknowledgedBy ?? [];
    return !acknowledged.includes(message.to);
  }

  private pruneMessageQueue(queue: TeamMessage[]): TeamMessage[] {
    const cutoff = Date.now() - TEAM_MESSAGE_TTL_MS;

    // TTL eviction: never expire a message that still has an unacknowledged
    // required recipient, even if it is past the TTL window.
    const expired: TeamMessage[] = [];
    const afterTtl: TeamMessage[] = [];
    for (const message of queue) {
      if (message.timestamp < cutoff && !this.isMessageProtected(message)) {
        expired.push(message);
      } else {
        afterTtl.push(message);
      }
    }

    // Overflow eviction: drop oldest fully-acknowledged messages first; protected
    // messages are kept even if that leaves the queue above the soft cap.
    const overflowCount = Math.max(0, afterTtl.length - TEAM_MESSAGE_QUEUE_CAP);
    const overflow: TeamMessage[] = [];
    const survivors: TeamMessage[] = [];
    let remainingToEvict = overflowCount;
    for (const message of afterTtl) {
      if (remainingToEvict > 0 && !this.isMessageProtected(message)) {
        overflow.push(message);
        remainingToEvict--;
      } else {
        survivors.push(message);
      }
    }

    queue.splice(0, queue.length, ...survivors);
    return [...expired, ...overflow];
  }

  private async pruneAllMessageQueues(): Promise<void> {
    const pruned: TeamMessage[] = [];
    for (const queue of this.messageQueue.values()) {
      pruned.push(...this.pruneMessageQueue(queue));
    }
    await this.deleteStoredMessages(pruned);
  }

  private async deleteStoredMessages(messages: TeamMessage[]): Promise<void> {
    await Promise.all(
      messages.map((message) => this.store.delete("team-message", `team-message-${message.id}`))
    );
  }

  private async pushMessageToActiveSessions(msg: TeamMessage): Promise<void> {
    if (!this.client || typeof this.client.session?.promptAsync !== "function") return;
    const sessions = this.spawnedSessions.get(msg.teamName) ?? [];
    const targets = sessions.filter(
      (session) =>
        session.status === "running" && (msg.to === "broadcast" || msg.to === session.agentName)
    );
    await Promise.all(
      targets.map(async (session) => {
        try {
          await this.client?.session.promptAsync({
            path: { id: session.sessionId },
            body: {
              agent: session.agentName,
              parts: [
                {
                  type: "text" as const,
                  text: [
                    `Team message for ${session.agentName}`,
                    `From: ${msg.from}`,
                    `Kind: ${msg.kind}`,
                    `Message: ${msg.content}`,
                  ].join("\n"),
                },
              ],
            },
          });
        } catch {
          // Best-effort delivery only; persisted inbox remains source of truth.
        }
      })
    );
  }

  getMessages(teamName: string, memberName: string, limit = 20): TeamMessage[] {
    const queue = this.messageQueue.get(teamName) ?? [];
    return queue
      .filter((m) => m.to === memberName || m.to === "broadcast")
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);
  }

  async acknowledgeMessages(
    teamName: string,
    memberName: string,
    messageIds?: string[]
  ): Promise<number> {
    const queue = this.messageQueue.get(teamName) ?? [];
    const idFilter = messageIds && messageIds.length > 0 ? new Set(messageIds) : undefined;
    const timestamp = Date.now();
    let count = 0;
    for (const msg of queue) {
      const visible = msg.to === memberName || msg.to === "broadcast";
      if (!visible || (idFilter && !idFilter.has(msg.id))) continue;
      msg.acknowledgedBy = msg.acknowledgedBy ?? [];
      msg.acknowledgedAt = msg.acknowledgedAt ?? {};
      if (msg.acknowledgedBy.includes(memberName)) continue;
      msg.acknowledgedBy.push(memberName);
      msg.acknowledgedAt[memberName] = timestamp;
      count++;
      await this.store.save({
        id: `team-message-${msg.id}`,
        type: "team-message",
        content: JSON.stringify(msg),
        timestamp: msg.timestamp,
        metadata: { teamName, from: msg.from, to: msg.to, kind: msg.kind },
      });
    }
    return count;
  }

  async recoverSessions(): Promise<number> {
    if (!this.client || typeof this.client.session?.status !== "function") return 0;
    let changed = 0;
    for (const [teamName, sessions] of this.spawnedSessions.entries()) {
      let mutated = false;
      for (const session of sessions) {
        if (
          session.status !== "unknown" &&
          session.status !== "running" &&
          session.status !== "pending"
        ) {
          continue;
        }
        try {
          const statusResult = await this.client.session.status();
          const type = statusResult.data?.[session.sessionId]?.type;
          if (type === "idle") {
            const messagesResult = await this.client.session.messages({
              path: { id: session.sessionId },
            });
            const messages = messagesResult.data ?? [];
            let result = "";
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i]?.info.role === "assistant") {
                result = messages[i].parts?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
                break;
              }
            }
            session.status = "completed";
            session.result = result;
            mutated = true;
            changed++;
          }
        } catch {
          session.status = "error";
          mutated = true;
          changed++;
        }
      }
      if (mutated) {
        await this.store.save({
          id: teamSessionMemoryId(teamName),
          type: "team-session",
          content: JSON.stringify({ teamName, sessions }),
          timestamp: Date.now(),
          metadata: { sessionCount: sessions.length },
        });
      }
    }
    return changed;
  }

  getSpawnedSessions(teamName: string): SpawnedSession[] {
    return this.spawnedSessions.get(teamName) ?? [];
  }

  getAgentTeamContext(agentName: string): string {
    const teams = this.getAllTeams().filter((team) =>
      team.members.some((member) => member.agentName === agentName)
    );
    if (teams.length === 0) return "";
    return [
      "## Hera Team Membership",
      "You are part of the following Hera team(s). Coordinate with peers via `hera_team_message`, check your inbox with `hera_get_team_messages`, and acknowledge handled messages with `hera_ack_team_messages`. Use `hera_team_remember` to publish to the team's shared workspace (visible to all members) and `hera_team_recall` to read what others have published. Treat this workspace as the team blackboard for decisions, context, and results.",
      "",
      ...teams.map((team) => this.buildTeamContext(team.name)),
    ].join("\n");
  }

  buildTeamContext(teamName: string): string {
    const team = this.teams.get(teamName);
    if (!team) return "";
    const members = team.members.map((m) => `- **${m.agentName}** (${m.role})`).join("\n");
    const management = team.management ?? "simple";
    const sessions = this.spawnedSessions.get(teamName) ?? [];
    const sessionInfo =
      sessions.length > 0
        ? `\nActive Sessions:\n${sessions.map((s) => `- ${s.agentName}: ${s.status} (${s.sessionId})`).join("\n")}`
        : "";
    return [
      `## Team: ${team.name}`,
      `Description: ${team.description}`,
      `Coordination: ${team.coordination}`,
      `Management: ${management} — ${TEAM_MANAGEMENT_DESCRIPTIONS[management]}`,
      `Shared Workspace: use hera_team_remember/hera_team_recall as the team blackboard.`,
      team.workflow ? `Workflow Recipe: ${team.workflow.name}` : "Workflow Recipe: not set",
      team.workflow ? `## Workflow Recipe\n${summarizeTeamWorkflowRecipe(team.workflow)}` : "",
      `Members:`,
      members,
      sessionInfo,
    ].join("\n");
  }
}

function teamMemoryId(teamName: string): string {
  return `team-${safeMemoryIdSegment(teamName)}`;
}

function teamSessionMemoryId(teamName: string): string {
  return `team-session-${safeMemoryIdSegment(teamName)}`;
}

function safeMemoryIdSegment(value: string): string {
  return Array.from(value, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("-");
}
