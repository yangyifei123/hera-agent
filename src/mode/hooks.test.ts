// src/mode/hooks.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import {
  ModeDispatchGuard,
  makeModeTextPart,
  extractModeToken,
  applyCommandModeHook,
  applyChatModeFallback,
} from "./hooks.js";
import { DriveModeStore } from "./store.js";
import { StubProgramRunner } from "./route.js";
import type { ProgramRunner, ProgramResult, SessionCtx } from "../types.js";

function textPart(text: string): any {
  return { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text };
}

class FakeRunner implements ProgramRunner {
  calls: Array<{ skill: string; ctx: SessionCtx }> = [];
  constructor(private result: ProgramResult) {}
  async run(skill: string, _args: unknown, ctx: SessionCtx): Promise<ProgramResult> {
    this.calls.push({ skill, ctx });
    return this.result;
  }
}

describe("ModeDispatchGuard", () => {
  it("consume is false without a prior mark", () => {
    expect(new ModeDispatchGuard().consume("s1")).toBe(false);
  });

  it("consume is true exactly once after markHandled", () => {
    const g = new ModeDispatchGuard();
    g.markHandled("s1");
    expect(g.consume("s1")).toBe(true);
    expect(g.consume("s1")).toBe(false);
  });
});

describe("makeModeTextPart", () => {
  it("builds a synthetic text part carrying the reply", () => {
    const part = makeModeTextPart("s1", "hello") as any;
    expect(part.type).toBe("text");
    expect(part.text).toBe("hello");
    expect(part.sessionID).toBe("s1");
    expect(part.synthetic).toBe(true);
    expect(typeof part.id).toBe("string");
  });
});

describe("extractModeToken", () => {
  it("returns null for non-/mode text", () => {
    expect(extractModeToken("hello world")).toBeNull();
  });

  it("does not match /mode as a prefix of a longer word", () => {
    expect(extractModeToken("/modexyz")).toBeNull();
  });

  it("extracts args for a leading /mode token", () => {
    expect(extractModeToken("/mode auto")).toEqual({ args: "auto", rest: "" });
  });

  it("extracts empty args for a bare /mode", () => {
    expect(extractModeToken("/mode")).toEqual({ args: "", rest: "" });
  });

  it("tolerates leading whitespace and keeps trailing lines as rest", () => {
    expect(extractModeToken("  /mode program deploy\nplease")).toEqual({
      args: "program deploy",
      rest: "please",
    });
  });
});

describe("applyCommandModeHook", () => {
  let store: DriveModeStore;
  let guard: ModeDispatchGuard;
  beforeEach(() => {
    store = new DriveModeStore();
    guard = new ModeDispatchGuard();
  });

  it("ignores commands other than mode", async () => {
    const output = { parts: [] as any[] };
    await applyCommandModeHook({ command: "other", sessionID: "s1", arguments: "" }, output, {
      store,
      runner: new StubProgramRunner(),
      guard,
      directory: "/d",
    });
    expect(output.parts).toHaveLength(0);
  });

  it("sets the sticky mode, marks the guard, and pushes a reply part", async () => {
    const output = { parts: [] as any[] };
    await applyCommandModeHook({ command: "mode", sessionID: "s1", arguments: "auto" }, output, {
      store,
      runner: new StubProgramRunner(),
      guard,
      directory: "/d",
    });
    expect(store.get("s1")).toBe("auto");
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].text).toContain("auto");
    expect(guard.consume("s1")).toBe(true);
  });

  it("routes a program run to the runner", async () => {
    const runner = new FakeRunner({ ok: true, value: "ok", logs: [] });
    const output = { parts: [] as any[] };
    await applyCommandModeHook(
      { command: "mode", sessionID: "s1", arguments: "program deploy" },
      output,
      { store, runner, guard, directory: "/work" }
    );
    expect(runner.calls[0].skill).toBe("deploy");
    expect(runner.calls[0].ctx).toEqual({ sessionID: "s1", directory: "/work" });
    expect(output.parts[0].text).toContain("deploy");
  });
});

describe("applyChatModeFallback", () => {
  let store: DriveModeStore;
  let guard: ModeDispatchGuard;
  const deps = () => ({ store, runner: new StubProgramRunner(), guard, directory: "/d" });
  beforeEach(() => {
    store = new DriveModeStore();
    guard = new ModeDispatchGuard();
  });

  it("does nothing when the first text part is not a /mode token", async () => {
    const output = { parts: [textPart("just chatting")] };
    await applyChatModeFallback({ sessionID: "s1" }, output, deps());
    expect(output.parts[0].text).toBe("just chatting");
    expect(store.get("s1")).toBe("collab");
  });

  it("applies a literal /mode token, sets the mode, and strips the token", async () => {
    const output = { parts: [textPart("/mode auto")] };
    await applyChatModeFallback({ sessionID: "s1" }, output, deps());
    expect(store.get("s1")).toBe("auto");
    expect(output.parts[0].text).toContain("auto");
    expect(output.parts[0].text.startsWith("/mode")).toBe(false);
  });

  it("only strips (does not re-apply) when a command run was already handled", async () => {
    guard.markHandled("s1");
    store.set("s1", "collab"); // sentinel: fallback must NOT flip this to auto
    const output = { parts: [textPart("/mode auto")] };
    await applyChatModeFallback({ sessionID: "s1" }, output, deps());
    expect(store.get("s1")).toBe("collab");
    expect(output.parts[0].text).toBe("");
  });
});
