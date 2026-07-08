// src/mode/route.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { StubProgramRunner, handleModeCommand } from "./route.js";
import { DriveModeStore } from "./store.js";
import type { ProgramRunner, ProgramResult, SessionCtx } from "../types.js";

const CTX: SessionCtx = { sessionID: "s1", directory: "/work" };

class FakeRunner implements ProgramRunner {
  calls: Array<{ skill: string; args: unknown; ctx: SessionCtx }> = [];
  constructor(private result: ProgramResult | (() => Promise<ProgramResult>)) {}
  async run(skill: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult> {
    this.calls.push({ skill, args, ctx });
    return typeof this.result === "function" ? this.result() : this.result;
  }
}

describe("StubProgramRunner", () => {
  it("always reports the engine is unavailable", async () => {
    const r = await new StubProgramRunner().run("x", {}, CTX);
    expect(r).toEqual({ ok: false, error: "program engine not yet available", logs: [] });
  });
});

describe("handleModeCommand", () => {
  let store: DriveModeStore;
  beforeEach(() => {
    store = new DriveModeStore();
  });

  it("returns the status text for an empty command and changes nothing", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("", CTX, { store, runner });
    expect(reply).toContain("Drive mode: collab");
    expect(runner.calls).toHaveLength(0);
  });

  it("sets the sticky mode to auto and confirms", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("auto", CTX, { store, runner });
    expect(reply).toContain("auto");
    expect(store.get("s1")).toBe("auto");
  });

  it("sets the sticky mode to collab", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    store.set("s1", "auto");
    await handleModeCommand("collab", CTX, { store, runner });
    expect(store.get("s1")).toBe("collab");
  });

  it("returns the parse error and leaves the mode unchanged for garbage", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("wat", CTX, { store, runner });
    expect(reply).toContain('Unknown mode "wat"');
    expect(store.get("s1")).toBe("collab");
  });

  it("routes a program run to the runner with the parsed skill and ctx", async () => {
    const runner = new FakeRunner({ ok: true, value: "done", logs: ["step 1"] });
    const reply = await handleModeCommand("program deploy", CTX, { store, runner });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].skill).toBe("deploy");
    expect(runner.calls[0].ctx).toEqual(CTX);
    expect(reply).toContain("deploy");
    expect(reply).toContain("done");
    expect(reply).toContain("step 1");
  });

  it("does not change the sticky mode when running a program", async () => {
    const runner = new FakeRunner({ ok: true, value: "ok", logs: [] });
    store.set("s1", "auto");
    await handleModeCommand("program deploy", CTX, { store, runner });
    expect(store.get("s1")).toBe("auto");
  });

  it("errors (and does not call the runner) when program has no skill", async () => {
    const runner = new FakeRunner({ ok: true, value: 1, logs: [] });
    const reply = await handleModeCommand("program", CTX, { store, runner });
    expect(reply).toContain("skill name is required");
    expect(runner.calls).toHaveLength(0);
  });

  it("renders a failed program result", async () => {
    const runner = new FakeRunner({ ok: false, error: "boom", logs: ["log a"] });
    const reply = await handleModeCommand("program deploy", CTX, { store, runner });
    expect(reply).toContain("failed");
    expect(reply).toContain("boom");
    expect(reply).toContain("log a");
  });

  it("catches a runner that throws and renders it as a failure", async () => {
    const runner = new FakeRunner(async () => {
      throw new Error("kaboom");
    });
    const reply = await handleModeCommand("program deploy", CTX, { store, runner });
    expect(reply).toContain("failed");
    expect(reply).toContain("kaboom");
  });
});
