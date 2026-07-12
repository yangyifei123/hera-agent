// src/agents/judge.test.ts
import { describe, expect, it } from "bun:test";
import { JUDGE_AGENT_NAME, createJudgeAgent } from "./judge.js";

describe("createJudgeAgent", () => {
  const cfg = createJudgeAgent("test-model", ["hera_create_agent", "hera_remember"]);

  it("is a zero-tool subagent", () => {
    expect(cfg.mode).toBe("subagent");
    expect(cfg.tools?.["hera_create_agent"]).toBe(false);
    expect(cfg.tools?.["hera_remember"]).toBe(false);
    expect(cfg.tools?.["hera_find_tools"]).toBe(false);
    expect(cfg.tools?.["hera_run_tool"]).toBe(false);
    expect(cfg.permission).toEqual({ edit: "deny", bash: "deny", webfetch: "deny" });
  });

  it("runs cold and shallow", () => {
    expect(cfg.temperature).toBe(0.1);
    expect(cfg.model).toBe("test-model");
    expect((cfg.maxSteps ?? 99) <= 3).toBe(true);
  });

  it("prompt is judge-only: no factory persona, JSON discipline", () => {
    expect(cfg.prompt).toContain("judge");
    expect(cfg.prompt).toContain("JSON");
    expect(cfg.prompt?.toLowerCase()).toContain("no tools");
    expect(cfg.prompt).not.toContain("Agent Factory");
  });

  it("exports the canonical name", () => {
    expect(JUDGE_AGENT_NAME).toBe("hera-judge");
  });
});
