import { describe, it, expect, mock, beforeEach } from "bun:test";
import { persistAgent, removeAgent } from "./persistence.js";
import type { AgentDefinition, SkillDefinition } from "./types.js";
import type { AgentRegistry } from "./agents/registry.js";
import type { MemoryStore } from "./memory/store.js";

// --- Mock Factories ---

function makeAgentDef(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: "test-agent",
    description: "Test",
    mode: "subagent",
    prompt: "You are test.",
    skills: ["caveman", "init", "memory", "evolution"],
    createdAt: Date.now(),
    evolutionLog: [],
    ...overrides,
  };
}

function makeMockRegistry() {
  return {
    register: mock(async () => ({
      config: { description: "test", mode: "subagent" },
      fileWritten: "/agents/hera/test-agent.md",
    })),
    unregister: mock(async () => true),
  } as unknown as AgentRegistry;
}

function makeMockStore() {
  return {
    save: mock(async () => {}),
    delete: mock(async () => true),
  } as unknown as MemoryStore;
}

describe("persistAgent", () => {
  let registeredAgents: Map<string, AgentDefinition>;
  let registry: AgentRegistry;
  let store: MemoryStore;
  let skillsMap: Map<string, SkillDefinition>;

  beforeEach(() => {
    registeredAgents = new Map();
    registry = makeMockRegistry();
    store = makeMockStore();
    skillsMap = new Map();
  });

  it("sets agent in registeredAgents", async () => {
    const def = makeAgentDef();
    await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(registeredAgents.get("test-agent")).toBe(def);
  });

  it("calls agentRegistry.register with def and skills", async () => {
    const def = makeAgentDef();
    await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(registry.register).toHaveBeenCalledWith(def, skillsMap);
    expect(registry.register).toHaveBeenCalledTimes(1);
  });

  it("calls store.save with correct memory structure", async () => {
    const def = makeAgentDef();
    await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(store.save).toHaveBeenCalledTimes(1);
    const savedArg = (store.save as any).mock.calls[0][0];
    expect(savedArg.id).toBe("agent-test-agent");
    expect(savedArg.type).toBe("agent");
    expect(savedArg.content).toBe(JSON.stringify(def));
    expect(savedArg.metadata.mode).toBe("subagent");
    expect(savedArg.metadata.fileWritten).toBe("/agents/hera/test-agent.md");
    expect(typeof savedArg.timestamp).toBe("number");
  });

  it("returns config, fileWritten, and memoryId", async () => {
    const def = makeAgentDef();
    const result = await persistAgent(def, skillsMap, registeredAgents, registry, store);
    expect(result.config).toEqual({ description: "test", mode: "subagent" });
    expect(result.fileWritten).toBe("/agents/hera/test-agent.md");
    expect(result.memoryId).toBe("agent-test-agent");
  });

  it("overwrites existing agent in registeredAgents", async () => {
    const oldDef = makeAgentDef({ description: "old" });
    registeredAgents.set("test-agent", oldDef);
    const newDef = makeAgentDef({ description: "new" });
    await persistAgent(newDef, skillsMap, registeredAgents, registry, store);
    expect(registeredAgents.get("test-agent")).toBe(newDef);
    expect(registeredAgents.get("test-agent")!.description).toBe("new");
  });
});

describe("removeAgent", () => {
  let registeredAgents: Map<string, AgentDefinition>;
  let registry: AgentRegistry;
  let store: MemoryStore;

  beforeEach(() => {
    registeredAgents = new Map();
    registeredAgents.set("test-agent", makeAgentDef());
    registry = makeMockRegistry();
    store = makeMockStore();
  });

  it("deletes from registeredAgents", async () => {
    await removeAgent("test-agent", registeredAgents, registry, store);
    expect(registeredAgents.has("test-agent")).toBe(false);
  });

  it("calls agentRegistry.unregister", async () => {
    await removeAgent("test-agent", registeredAgents, registry, store);
    expect(registry.unregister).toHaveBeenCalledWith("test-agent");
    expect(registry.unregister).toHaveBeenCalledTimes(1);
  });

  it("calls store.delete with correct args", async () => {
    await removeAgent("test-agent", registeredAgents, registry, store);
    expect(store.delete).toHaveBeenCalledWith("agent", "agent-test-agent");
    expect(store.delete).toHaveBeenCalledTimes(1);
  });

  it("returns store.delete result", async () => {
    const result = await removeAgent("test-agent", registeredAgents, registry, store);
    expect(result).toBe(true);
  });

  it("handles missing agent gracefully", async () => {
    // Agent not in map — should not throw
    const result = await removeAgent("nonexistent", registeredAgents, registry, store);
    expect(result).toBe(true);
    expect(registry.unregister).toHaveBeenCalledWith("nonexistent");
  });
});
