import { describe, expect, it } from "bun:test";
import { createAllTools, createAllToolsWithDomains } from "./index.js";
import type { PluginContext } from "../types.js";

// The factories only read ctx lazily inside execute() for most tools, but they
// destructure managers at creation time, so give them inert stubs.
function makeCtx(overrides: Partial<PluginContext> = {}): PluginContext {
  const stub = new Proxy({}, { get: () => () => undefined });
  return {
    store: stub,
    skillManager: stub,
    teamManager: stub,
    workflowManager: stub,
    distillation: stub,
    agentRegistry: stub,
    registeredAgents: new Map(),
    client: stub,
    taskStore: stub,
    loopManager: stub,
    supervisor: stub,
    config: {},
    paths: stub,
    autoEvolve: false,
    driveModeStore: stub,
    programRunner: stub,
    ...overrides,
  } as unknown as PluginContext;
}

describe("createAllToolsWithDomains", () => {
  it("labels every tool with one of the 14 domains", () => {
    const { tools, domains } = createAllToolsWithDomains(makeCtx());
    const names = Object.keys(tools);
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) {
      expect(domains[name]).toBeDefined();
    }
    const distinct = new Set(Object.values(domains));
    expect(distinct.size).toBe(14);
    expect(domains["hera_load_skill"]).toBe("skill");
    expect(domains["hera_create_agent"]).toBe("agent");
  });

  it("filters disabled_tools from both tools and domains", () => {
    const ctx = makeCtx({ config: { disabled_tools: ["hera_load_skill"] } });
    const { tools, domains } = createAllToolsWithDomains(ctx);
    expect(tools["hera_load_skill"]).toBeUndefined();
    expect(domains["hera_load_skill"]).toBeUndefined();
  });

  it("createAllTools stays behavior-identical (delegation)", () => {
    const a = Object.keys(createAllTools(makeCtx())).sort();
    const b = Object.keys(createAllToolsWithDomains(makeCtx()).tools).sort();
    expect(a).toEqual(b);
  });
});
