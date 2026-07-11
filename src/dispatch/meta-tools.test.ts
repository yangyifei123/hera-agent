// src/dispatch/meta-tools.test.ts
import { describe, expect, it } from "bun:test";
import { tool } from "@opencode-ai/plugin";
import type { AgentDefinition } from "../types.js";
import { ToolCatalog } from "./catalog.js";
import { createDispatchTools } from "./meta-tools.js";

const z = tool.schema;

const calls: Array<{ name: string; args: unknown; agent: string }> = [];

function fixture(defOverrides: Partial<AgentDefinition> = {}, disabled: string[] = []) {
  calls.length = 0;
  const tools = {
    hera_create_agent: tool({
      description: "Create a new child agent.",
      args: { name: z.string(), prompt: z.string().optional() },
      async execute(args, ctx) {
        calls.push({ name: "hera_create_agent", args, agent: (ctx as { agent: string }).agent });
        return `created ${args.name}`;
      },
    }),
    hera_explode: tool({
      description: "Always throws (for dispatcher error-path tests).",
      args: {},
      async execute() {
        throw new Error("boom");
      },
    }),
  };
  const domains = { hera_create_agent: "agent", hera_explode: "system" };
  const def: AgentDefinition = {
    name: "child1",
    description: "d",
    mode: "subagent",
    prompt: "p",
    skills: [],
    ...defOverrides,
  };
  const deps = {
    catalog: new ToolCatalog(tools, domains),
    registeredAgents: new Map([[def.name, def]]),
    config: { disabled_tools: disabled },
  };
  return createDispatchTools(deps);
}

const ctx = { agent: "child1", sessionID: "s", messageID: "m" } as never;

describe("hera_find_tools", () => {
  it("with no args returns the domain listing", async () => {
    const { hera_find_tools } = fixture();
    const out = String(await hera_find_tools.execute({} as never, ctx));
    expect(out).toContain("agent (1)");
    expect(out).toContain("system (1)");
  });

  it("search returns name, domain, description and args summary", async () => {
    const { hera_find_tools } = fixture();
    const out = String(await hera_find_tools.execute({ query: "create agent" } as never, ctx));
    expect(out).toContain("hera_create_agent");
    expect(out).toContain("(agent)");
    expect(out).toContain("name: string");
  });

  it("hides tools the caller is not authorized for", async () => {
    const { hera_find_tools } = fixture({ tools: { hera_create_agent: false } });
    const out = String(await hera_find_tools.execute({ query: "create agent" } as never, ctx));
    expect(out).not.toContain("hera_create_agent");
  });
});

describe("hera_run_tool", () => {
  it("happy path: validates args and forwards to the target with the original context", async () => {
    const { hera_run_tool } = fixture();
    const out = await hera_run_tool.execute(
      { tool: "hera_create_agent", args: { name: "bob" } } as never,
      ctx
    );
    expect(String(out)).toBe("created bob");
    expect(calls[0]).toEqual({ name: "hera_create_agent", args: { name: "bob" }, agent: "child1" });
  });

  it("unknown tool: actionable error with did-you-mean", async () => {
    const { hera_run_tool } = fixture();
    const out = String(
      await hera_run_tool.execute({ tool: "hera_create_agnet", args: {} } as never, ctx)
    );
    expect(out).toStartWith("Error:");
    expect(out).toContain("hera_create_agent");
  });

  it("denied by agent tools map: names the denying layer", async () => {
    const { hera_run_tool } = fixture({ tools: { hera_create_agent: false } });
    const out = String(
      await hera_run_tool.execute({ tool: "hera_create_agent", args: { name: "x" } } as never, ctx)
    );
    expect(out).toStartWith("Error:");
    expect(out).toContain("agent's tools map");
    expect(calls).toHaveLength(0);
  });

  it("invalid args: lists zod issues and the expected schema", async () => {
    const { hera_run_tool } = fixture();
    const out = String(
      await hera_run_tool.execute({ tool: "hera_create_agent", args: {} } as never, ctx)
    );
    expect(out).toStartWith("Error:");
    expect(out).toContain("name");
    expect(out).toContain("name: string");
    expect(calls).toHaveLength(0);
  });

  it("target throws: caught and reported, never propagated", async () => {
    const { hera_run_tool } = fixture();
    const out = String(
      await hera_run_tool.execute({ tool: "hera_explode", args: {} } as never, ctx)
    );
    expect(out).toStartWith("Error:");
    expect(out).toContain("hera_explode");
    expect(out).toContain("boom");
  });

  it("meta-tool self-dispatch is refused", async () => {
    const { hera_run_tool } = fixture();
    const out = String(
      await hera_run_tool.execute({ tool: "hera_run_tool", args: {} } as never, ctx)
    );
    expect(out).toStartWith("Error:");
  });
});
