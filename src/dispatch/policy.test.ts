// src/dispatch/policy.test.ts
import { describe, expect, it } from "bun:test";
import type { AgentDefinition } from "../types.js";
import {
  META_TOOL_NAMES,
  buildNativeToolsMap,
  checkDispatch,
  computeHeraHotSet,
} from "./policy.js";
import { DEFAULT_CHILD_NATIVE_TOOLS } from "../constants.js";

function agent(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "child1",
    description: "d",
    mode: "subagent",
    prompt: "p",
    skills: [],
    ...over,
  };
}

const deps = (def?: AgentDefinition, disabled?: string[]) => ({
  registeredAgents: new Map(def ? [[def.name, def]] : []),
  config: { disabled_tools: disabled },
});

describe("checkDispatch", () => {
  it("allows an ordinary tool for an agent with no restrictions", () => {
    expect(checkDispatch("hera_create_agent", "child1", deps(agent()))).toEqual({ allowed: true });
  });

  it("denies the meta-tools themselves", () => {
    for (const name of META_TOOL_NAMES) {
      expect(checkDispatch(name, "child1", deps(agent()))).toEqual({
        allowed: false,
        reason: "meta-tool",
      });
    }
  });

  it("denies globally disabled tools", () => {
    expect(
      checkDispatch("hera_create_agent", "child1", deps(agent(), ["hera_create_agent"]))
    ).toEqual({
      allowed: false,
      reason: "disabled-tools",
    });
  });

  it("denies tools the agent's tools map sets to false", () => {
    const def = agent({ tools: { hera_delete_agent: false } });
    expect(checkDispatch("hera_delete_agent", "child1", deps(def))).toEqual({
      allowed: false,
      reason: "agent-tools-map",
    });
    expect(checkDispatch("hera_create_agent", "child1", deps(def))).toEqual({ allowed: true });
  });

  it("allows for unknown agents (e.g. hera itself is not in registeredAgents)", () => {
    expect(checkDispatch("hera_create_agent", "hera", deps())).toEqual({ allowed: true });
  });
});

describe("buildNativeToolsMap", () => {
  const heraToolNames = ["hera_a", "hera_b", "hera_load_skill"];

  it("enables exactly hotSet ∪ meta-tools, denies the rest", () => {
    const map = buildNativeToolsMap({ hotSet: ["hera_a"], heraToolNames });
    expect(map["hera_a"]).toBe(true);
    expect(map["hera_b"]).toBe(false);
    expect(map["hera_load_skill"]).toBe(false);
    expect(map["hera_find_tools"]).toBe(true);
    expect(map["hera_run_tool"]).toBe(true);
  });

  it("authorization denies always win over the hot set", () => {
    const map = buildNativeToolsMap({
      hotSet: ["hera_a"],
      heraToolNames,
      defTools: { hera_a: false },
    });
    expect(map["hera_a"]).toBe(false);
  });

  it("passes non-hera def.tools entries through untouched", () => {
    const map = buildNativeToolsMap({
      hotSet: [],
      heraToolNames,
      defTools: { bash: false, webfetch: true },
    });
    expect(map["bash"]).toBe(false);
    expect(map["webfetch"]).toBe(true);
  });
});

describe("computeHeraHotSet", () => {
  it("is defaults ∪ all tools in the factory-core domains", () => {
    const domains = {
      hera_create_agent: "agent",
      hera_create_skill: "skill",
      hera_create_team: "team",
      hera_run_workflow: "workflow",
    };
    const hot = computeHeraHotSet(domains);
    expect(hot).toContain("hera_create_agent");
    expect(hot).toContain("hera_create_skill");
    expect(hot).toContain("hera_create_team");
    expect(hot).not.toContain("hera_run_workflow");
    for (const t of DEFAULT_CHILD_NATIVE_TOOLS) expect(hot).toContain(t);
  });
});
