// src/dispatch/catalog.test.ts
import { describe, expect, it } from "bun:test";
import { tool } from "@opencode-ai/plugin";
import {
  ToolCatalog,
  renderArgsSummary,
  renderCatalogPrimer,
  scoreEntry,
  tokenize,
} from "./catalog.js";

const z = tool.schema;

function fakeTools() {
  const t = (description: string, args: Record<string, unknown>) =>
    tool({
      description,
      args: args as never,
      async execute() {
        return "ok";
      },
    });
  return {
    tools: {
      hera_create_agent: t("Create a new child agent from a template or prompt.", {
        name: z.string().describe("Agent name"),
        prompt: z.string().optional(),
      }),
      hera_delete_agent: t("Delete an existing agent and back it up first.", {
        name: z.string(),
      }),
      hera_team_status: t("Show the status of a running team.", {
        team: z.string(),
      }),
    },
    domains: {
      hera_create_agent: "agent",
      hera_delete_agent: "agent",
      hera_team_status: "team",
    },
  };
}

describe("ToolCatalog", () => {
  const { tools, domains } = fakeTools();
  const catalog = new ToolCatalog(tools, domains);

  it("indexes every tool with domain + description + argsShape", () => {
    expect(catalog.names().sort()).toEqual([
      "hera_create_agent",
      "hera_delete_agent",
      "hera_team_status",
    ]);
    const hit = catalog.get("hera_create_agent");
    expect(hit?.entry.domain).toBe("agent");
    expect(hit?.entry.description).toContain("Create a new child agent");
    expect(Object.keys(hit?.entry.argsShape ?? {})).toEqual(["name", "prompt"]);
  });

  it("listDomains returns counts, sorted by domain name", () => {
    expect(catalog.listDomains()).toEqual([
      { domain: "agent", count: 2 },
      { domain: "team", count: 1 },
    ]);
  });

  it("search ranks name hits above description hits, deterministically", () => {
    const results = catalog.search("create agent");
    expect(results[0]?.name).toBe("hera_create_agent");
    // deterministic: same query, same order, every time
    expect(catalog.search("create agent")).toEqual(results);
  });

  it("search supports domain filter and limit", () => {
    expect(catalog.search("agent", { domain: "team" }).every((e) => e.domain === "team")).toBe(
      true
    );
    expect(catalog.search("agent", { limit: 1 })).toHaveLength(1);
  });

  it("excludes meta-tools from the index even if present in input", () => {
    const withMeta = new ToolCatalog(
      { ...tools, hera_run_tool: tools.hera_create_agent },
      { ...domains, hera_run_tool: "dispatch" }
    );
    expect(withMeta.get("hera_run_tool")).toBeUndefined();
  });
});

describe("scoring", () => {
  it("tokenize lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("Create-Agent, NOW!")).toEqual(["create", "agent", "now"]);
  });

  it("name token match scores higher than description match", () => {
    const nameEntry = {
      name: "hera_create_agent",
      domain: "agent",
      description: "x",
      argsShape: {},
    };
    const descEntry = {
      name: "hera_x",
      domain: "agent",
      description: "create agent",
      argsShape: {},
    };
    expect(scoreEntry(nameEntry, ["create"])).toBeGreaterThan(scoreEntry(descEntry, ["create"]));
  });
});

describe("renderArgsSummary", () => {
  it("renders name/optionality/type for each arg", () => {
    const s = renderArgsSummary({
      name: z.string(),
      prompt: z.string().optional(),
      count: z.number().optional(),
    } as never);
    expect(s).toBe("name: string, prompt?: string, count?: number");
  });
});

describe("renderCatalogPrimer", () => {
  it("mentions both meta-tools and every domain with counts", () => {
    const { tools, domains } = fakeTools();
    const primer = renderCatalogPrimer(new ToolCatalog(tools, domains));
    expect(primer).toContain("hera_find_tools");
    expect(primer).toContain("hera_run_tool");
    expect(primer).toContain("agent (2)");
    expect(primer).toContain("team (1)");
  });
});
