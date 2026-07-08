// src/engine/opencode-agent-runner.ts
import type { OpenCodeClient } from "../types/client.js";
import type { AgentRunner } from "./executor.js";
import { TEAM_POLL_MAX_ATTEMPTS, TEAM_POLL_INTERVAL_MS } from "../constants.js";

export class OpenCodeAgentRunner implements AgentRunner {
  constructor(
    private client: OpenCodeClient | undefined,
    private directory: string
  ) {}

  async run(executor: string, prompt: string, signal?: AbortSignal): Promise<string> {
    if (!this.client) throw new Error("OpenCode client unavailable for task execution");
    if (signal?.aborted) throw new Error("attempt aborted before start");
    const created = await this.client.session.create({
      body: { title: `Hera task → @${executor}` },
      query: { directory: this.directory },
    });
    const sessionId = created.data?.id;
    if (!sessionId) throw new Error("OpenCode session creation failed");
    try {
      await this.client.session.promptAsync({
        path: { id: sessionId },
        body: { agent: executor, parts: [{ type: "text" as const, text: prompt }] },
      });
      for (let i = 0; i < TEAM_POLL_MAX_ATTEMPTS; i++) {
        if (signal?.aborted) throw new Error("attempt aborted");
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
        await this.wait(TEAM_POLL_INTERVAL_MS, signal);
      }
      throw new Error("Task agent timed out");
    } catch (err) {
      // Timeout / cancel / prompt failure: tear down the underlying session so
      // it does not keep running orphaned (and conflict with a retry's fresh
      // session editing the same cwd). Best-effort — never mask the real error.
      await this.abortSession(sessionId);
      throw err;
    }
  }

  /** Sleep that rejects promptly when the attempt is aborted. */
  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        cleanup();
        reject(new Error("attempt aborted"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private async abortSession(sessionId: string): Promise<void> {
    try {
      await this.client?.session.abort({
        path: { id: sessionId },
        query: { directory: this.directory },
      });
    } catch {
      // best effort: the server may have already finished/aborted the session
    }
  }
}
