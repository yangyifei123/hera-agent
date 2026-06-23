// src/engine/opencode-agent-runner.ts
import type { OpenCodeClient } from "../types/client.js";
import type { AgentRunner } from "./executor.js";
import { TEAM_POLL_MAX_ATTEMPTS, TEAM_POLL_INTERVAL_MS } from "../constants.js";

export class OpenCodeAgentRunner implements AgentRunner {
  constructor(
    private client: OpenCodeClient | undefined,
    private directory: string
  ) {}

  async run(executor: string, prompt: string): Promise<string> {
    if (!this.client) throw new Error("OpenCode client unavailable for task execution");
    const created = await this.client.session.create({
      body: { title: `Hera task → @${executor}` },
      query: { directory: this.directory },
    });
    const sessionId = created.data?.id;
    if (!sessionId) throw new Error("OpenCode session creation failed");
    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: { agent: executor, parts: [{ type: "text" as const, text: prompt }] },
    });
    for (let i = 0; i < TEAM_POLL_MAX_ATTEMPTS; i++) {
      const status = await this.client.session.status();
      if (status.data?.[sessionId]?.type === "idle") {
        const messages = await this.client.session.messages({ path: { id: sessionId } });
        const list = messages.data ?? [];
        for (let j = list.length - 1; j >= 0; j--) {
          if (list[j]?.info.role === "assistant") {
            return list[j].parts?.map((p) => ("text" in p ? p.text : "")).join("") ?? "";
          }
        }
        return "";
      }
      await new Promise((r) => setTimeout(r, TEAM_POLL_INTERVAL_MS));
    }
    throw new Error("Task agent timed out");
  }
}
