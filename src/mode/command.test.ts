import { describe, it, expect } from "bun:test";
import { parseModeCommand, renderModeStatus } from "./command.js";

describe("parseModeCommand", () => {
  it("treats empty input as a status request (no change)", () => {
    expect(parseModeCommand("")).toEqual({});
  });

  it("treats whitespace-only input as a status request", () => {
    expect(parseModeCommand("   ")).toEqual({});
  });

  it("parses auto", () => {
    expect(parseModeCommand("auto")).toEqual({ mode: "auto" });
  });

  it("parses collab", () => {
    expect(parseModeCommand("collab")).toEqual({ mode: "collab" });
  });

  it("is case-insensitive on the verb", () => {
    expect(parseModeCommand("AUTO")).toEqual({ mode: "auto" });
  });

  it("parses program with a skill name", () => {
    expect(parseModeCommand("program deploy")).toEqual({
      mode: "program",
      skill: "deploy",
    });
  });

  it("ignores extra tokens after the program skill name", () => {
    expect(parseModeCommand("program deploy now")).toEqual({
      mode: "program",
      skill: "deploy",
    });
  });

  it("errors on program without a skill name", () => {
    const r = parseModeCommand("program");
    expect(r.mode).toBeUndefined();
    expect(r.error).toContain("skill name is required");
  });

  it("errors on an unknown verb", () => {
    const r = parseModeCommand("wat");
    expect(r.mode).toBeUndefined();
    expect(r.error).toContain('Unknown mode "wat"');
    expect(r.error).toContain("auto, collab, program");
  });
});

describe("renderModeStatus", () => {
  it("shows the current mode and usage", () => {
    const s = renderModeStatus("collab");
    expect(s).toContain("Drive mode: collab");
    expect(s).toContain("/mode auto");
    expect(s).toContain("/mode program <skill>");
  });

  it("reflects the auto mode when current", () => {
    expect(renderModeStatus("auto")).toContain("Drive mode: auto");
  });
});
