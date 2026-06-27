import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import HeraPlugin from "./index.js";
import { MemoryStore } from "./memory/store.js";

/**
 * End-to-end smoke test of the `experimental.session.compacting` hook against
 * the CURRENT OpenCode contract: the input carries only a `sessionID`, so the
 * hook must FETCH messages via the client (not read input.messages, which is
 * gone). This is the regression that silently disabled auto-memory.
 */
describe("compacting hook auto-memory (current OpenCode API)", () => {
  let root: string;
  let prevEnv: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hera-compact-"));
    prevEnv = process.env.HERA_CONFIG_ROOT;
    process.env.HERA_CONFIG_ROOT = root; // isolate the plugin's config root
  });
  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.HERA_CONFIG_ROOT;
    else process.env.HERA_CONFIG_ROOT = prevEnv;
    await rm(root, { recursive: true, force: true });
  });

  function pluginInput(messagesImpl: (args: { path: { id: string } }) => Promise<unknown>) {
    const client = { session: { messages: messagesImpl } };
    return {
      client,
      project: { id: "p", worktree: root, time: { created: 0 } },
      directory: root,
      worktree: root,
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost:0"),
      $,
    } as never;
  }

  it("fetches messages by sessionID and persists auto-memory", async () => {
    let askedFor = "";
    const hooks = await HeraPlugin(
      pluginInput(async (args) => {
        askedFor = args.path.id;
        return {
          data: [
            {
              info: { role: "assistant" },
              parts: [{ text: "We decided to use NATS for messaging." }],
            },
          ],
        };
      }),
      { auto_memory: true } as never
    );

    const output = { context: [] as string[] };
    // Current API shape: { sessionID }, NOT { messages }.
    await (hooks["experimental.session.compacting"] as (i: unknown, o: unknown) => Promise<void>)(
      { sessionID: "sess-42" },
      output
    );

    expect(askedFor).toBe("sess-42"); // the hook fetched by id
    expect(output.context.join("\n")).toContain("Distill"); // directive still emitted

    // Auto-memory now actually persisted (was dead while the hook read input.messages).
    const store = new MemoryStore(join(root, "hera-data", "memory"));
    await store.init();
    const decisions = await store.list("decision");
    expect(decisions.some((d) => d.content.includes("NATS"))).toBe(true);
  });

  it("does not fetch messages when auto_memory is disabled", async () => {
    let called = false;
    const hooks = await HeraPlugin(
      pluginInput(async () => {
        called = true;
        return { data: [] };
      }),
      undefined
    );
    const output = { context: [] as string[] };
    await (hooks["experimental.session.compacting"] as (i: unknown, o: unknown) => Promise<void>)(
      { sessionID: "sess-1" },
      output
    );
    expect(output.context.length).toBeGreaterThanOrEqual(1); // compaction directive still works
    expect(called).toBe(false); // no needless client call
  });
});
