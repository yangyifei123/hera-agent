// src/tools/program-tools.test.ts
import { describe, it, expect } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { createProgramTools } from "./program-tools.js";
import type { PluginContext, ProgramResult } from "../types.js";

function ctxWithRunner(result: ProgramResult): PluginContext {
  return {
    programRunner: {
      run: async () => result,
    },
  } as unknown as PluginContext;
}

const TOOL_CTX: ToolContext = {
  sessionID: "s1",
  directory: "/work",
  worktree: "/work",
  messageID: "m1",
  agent: "hera",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: (() => {
    throw new Error("ask not used in test");
  }) as ToolContext["ask"],
};

describe("hera_run_program", () => {
  it("routes a successful run and formats value + logs", async () => {
    const tools = createProgramTools(
      ctxWithRunner({ ok: true, value: { title: "T" }, logs: ["l1"] })
    );
    const out = await tools.hera_run_program.execute(
      { skill: "release-notes", args: {} },
      TOOL_CTX
    );
    expect(out).toContain("succeeded");
    expect(out).toContain("release-notes");
    expect(out).toContain('"title":"T"');
    expect(out).toContain("l1");
  });

  it("routes a failed run and surfaces the error", async () => {
    const tools = createProgramTools(ctxWithRunner({ ok: false, error: "boom", logs: [] }));
    const out = await tools.hera_run_program.execute({ skill: "x", args: undefined }, TOOL_CTX);
    expect(out).toContain("failed");
    expect(out).toContain("boom");
  });

  it("passes the session directory through to the runner", async () => {
    let seenDir = "";
    const ctx = {
      programRunner: {
        run: async (_skill: string, _args: unknown, c: { directory: string }) => {
          seenDir = c.directory;
          return { ok: true, value: null, logs: [] } as ProgramResult;
        },
      },
    } as unknown as PluginContext;
    const tools = createProgramTools(ctx);
    await tools.hera_run_program.execute({ skill: "x", args: {} }, TOOL_CTX);
    expect(seenDir).toBe("/work");
  });
});
