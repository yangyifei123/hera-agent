// src/dispatch/meta-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { z } from "zod";
import type { AgentDefinition, HeraConfig } from "../types.js";
import { ToolCatalog, renderArgsSummary } from "./catalog.js";
import { checkDispatch, type DenyReason } from "./policy.js";

const zs = tool.schema;

const DENY_TEXT: Record<DenyReason, string> = {
  "meta-tool": "the dispatch meta-tools cannot invoke themselves",
  "disabled-tools": 'it is disabled in hera.json "disabled_tools"',
  "agent-tools-map": "your agent's tools map denies it",
};

export interface DispatchDeps {
  catalog: ToolCatalog;
  registeredAgents: Map<string, AgentDefinition>;
  config: HeraConfig;
}

function formatEntryLine(deps: DispatchDeps, name: string): string {
  const hit = deps.catalog.get(name);
  if (!hit) return `- ${name}`;
  const args = renderArgsSummary(hit.entry.argsShape);
  return [
    `- ${hit.entry.name} (${hit.entry.domain}) — ${hit.entry.description}`,
    args ? `  args: ${args}` : "  args: (none)",
  ].join("\n");
}

export function createDispatchTools(deps: DispatchDeps): Record<string, ToolDefinition> {
  const authorized = (agentName: string) => (name: string) =>
    checkDispatch(name, agentName, deps).allowed;

  return {
    hera_find_tools: tool({
      description:
        "Search the Hera tool catalog. Call with a query and/or domain to find dispatchable tools; call with no arguments to list domains. Use hera_run_tool to invoke a result.",
      args: {
        query: zs.string().optional().describe("Keywords to search names/descriptions"),
        domain: zs.string().optional().describe("Restrict to one domain (see the no-arg listing)"),
        limit: zs.number().optional().describe("Max results (default 8)"),
      },
      async execute(args, context) {
        const allow = authorized(context.agent);
        if (!args.query && !args.domain) {
          const lines = deps.catalog
            .listDomains()
            .map((d) => `- ${d.domain} (${d.count})`)
            .join("\n");
          return [
            "Tool domains (use domain or query to drill in):",
            lines,
            "",
            'Example: hera_find_tools({ query: "background task" })',
          ].join("\n");
        }
        const entries = args.query
          ? deps.catalog.search(args.query, { domain: args.domain, limit: args.limit ?? 8 })
          : deps.catalog.byDomain(args.domain ?? "");
        const visible = entries.filter((e) => allow(e.name));
        if (visible.length === 0) {
          return "No matching tools. Try hera_find_tools({}) to browse domains.";
        }
        return visible.map((e) => formatEntryLine(deps, e.name)).join("\n");
      },
    }),

    hera_run_tool: tool({
      description:
        "Invoke a catalog tool by name with JSON args (meta-dispatch). Args are validated against the target's schema; failures return the expected schema.",
      args: {
        tool: zs.string().describe("Target tool name, e.g. hera_create_team"),
        args: zs.any().optional().describe("Arguments for the target tool"),
      },
      async execute(args, context) {
        const decision = checkDispatch(args.tool, context.agent, deps);
        if (!decision.allowed) {
          return `Error: cannot dispatch "${args.tool}" — ${DENY_TEXT[decision.reason ?? "meta-tool"]}.`;
        }
        const hit = deps.catalog.get(args.tool);
        if (!hit) {
          const suggestions = deps.catalog
            .search(args.tool, { limit: 3 })
            .filter((e) => checkDispatch(e.name, context.agent, deps).allowed)
            .map((e) => e.name);
          const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
          return `Error: unknown tool "${args.tool}".${hint} Use hera_find_tools to search the catalog.`;
        }
        const parsed = z.object(hit.entry.argsShape).safeParse(args.args ?? {});
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
          return [
            `Error: invalid arguments for "${args.tool}":`,
            issues,
            `Expected args: ${renderArgsSummary(hit.entry.argsShape) || "(none)"}`,
          ].join("\n");
        }
        try {
          return await hit.def.execute(parsed.data as never, context);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error: tool "${args.tool}" failed: ${msg}`;
        }
      },
    }),
  };
}
