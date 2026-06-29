import { describe, it, expect } from "bun:test";
import { createChildAgentConfig, createAgentFromTemplate } from "./hera.js";
import { DEFAULT_CHILD_MAX_STEPS } from "../constants.js";

describe("createAgentFromTemplate", () => {
  it("does not duplicate skills that templates redundantly list (e.g. skill-combo)", () => {
    const def = createAgentFromTemplate("coder", "c1");
    expect(def.skills.filter((s) => s === "skill-combo")).toHaveLength(1);
    expect(new Set(def.skills).size).toBe(def.skills.length);
  });
});

describe("createChildAgentConfig", () => {
  it("uses defaults when no overrides are given", () => {
    const cfg = createChildAgentConfig("a", "desc", "prompt", "m/model");
    expect(cfg.maxSteps).toBe(DEFAULT_CHILD_MAX_STEPS);
    expect(cfg.permission).toBeDefined();
    expect(cfg.tools).toBeUndefined();
  });

  it("honors per-agent permission, tools, and maxSteps overrides", () => {
    const cfg = createChildAgentConfig("a", "desc", "prompt", "m/model", "subagent", {
      permission: { edit: "deny", bash: "ask" },
      tools: { bash: false, webfetch: true },
      maxSteps: 7,
    });
    expect(cfg.maxSteps).toBe(7);
    expect(cfg.permission).toEqual({ edit: "deny", bash: "ask" });
    expect(cfg.tools).toEqual({ bash: false, webfetch: true });
  });

  it("falls back to defaults for individually-omitted override fields", () => {
    const cfg = createChildAgentConfig("a", "desc", "prompt", "m/model", "subagent", {
      maxSteps: 5,
    });
    expect(cfg.maxSteps).toBe(5);
    expect(cfg.permission).toBeDefined();
    expect(cfg.tools).toBeUndefined();
  });
});
