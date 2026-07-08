// src/engine/opencode-agent-runner.test.ts
import { describe, it, expect } from "bun:test";
import { OpenCodeAgentRunner } from "./opencode-agent-runner.js";
import type { OpenCodeClient } from "../types/client.js";

interface MockCalls {
  aborted: string[];
  created: number;
}

/**
 * Minimal OpenCode client stub. `sessionType` controls what session.status()
 * reports so we can drive the idle (success) vs. never-idle (poll) paths.
 */
function mockClient(opts: {
  sessionType?: string;
  assistantText?: string;
  onPrompt?: () => void;
}): { client: OpenCodeClient; calls: MockCalls } {
  const calls: MockCalls = { aborted: [], created: 0 };
  const sessionType = opts.sessionType ?? "working";
  const client = {
    session: {
      create: async () => {
        calls.created++;
        return { data: { id: "sess-1" } };
      },
      promptAsync: async () => {
        opts.onPrompt?.();
        return { data: {} };
      },
      status: async () => ({ data: { "sess-1": { type: sessionType } } }),
      messages: async () => ({
        data: [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: opts.assistantText ?? "" }],
          },
        ],
      }),
      abort: async (o: { path: { id: string } }) => {
        calls.aborted.push(o.path.id);
        return { data: true };
      },
    },
  } as unknown as OpenCodeClient;
  return { client, calls };
}

describe("OpenCodeAgentRunner", () => {
  it("returns the last assistant message when the session goes idle", async () => {
    const { client } = mockClient({ sessionType: "idle", assistantText: "the result" });
    const runner = new OpenCodeAgentRunner(client, "/tmp");
    expect(await runner.run("hera", "do it")).toBe("the result");
  });

  it("aborts the underlying session and rejects when the attempt is aborted mid-poll", async () => {
    const { client, calls } = mockClient({ sessionType: "working" }); // never idle
    const runner = new OpenCodeAgentRunner(client, "/tmp");
    const controller = new AbortController();
    const p = runner.run("hera", "do it", controller.signal);
    // Abort shortly after the first poll begins.
    setTimeout(() => controller.abort(), 20);
    await expect(p).rejects.toThrow(/aborted/);
    expect(calls.aborted).toContain("sess-1");
  });

  it("does not start a session when the signal is already aborted", async () => {
    const { client, calls } = mockClient({ sessionType: "idle" });
    const runner = new OpenCodeAgentRunner(client, "/tmp");
    const controller = new AbortController();
    controller.abort();
    await expect(runner.run("hera", "do it", controller.signal)).rejects.toThrow(/aborted/);
    expect(calls.created).toBe(0);
  });

  it("tears down the session when prompt submission fails", async () => {
    const { client, calls } = mockClient({
      sessionType: "idle",
      onPrompt: () => {
        throw new Error("prompt rejected");
      },
    });
    const runner = new OpenCodeAgentRunner(client, "/tmp");
    await expect(runner.run("hera", "do it")).rejects.toThrow("prompt rejected");
    expect(calls.aborted).toContain("sess-1");
  });
});
