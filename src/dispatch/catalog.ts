// src/dispatch/catalog.ts
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ZodRawShape, ZodTypeAny } from "zod";
import { META_TOOL_NAMES } from "./policy.js";

export interface CatalogEntry {
  name: string;
  domain: string;
  description: string;
  argsShape: ZodRawShape;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Deterministic keyword score: name-token hits weigh 3, description hits 1,
 * exact domain match 2. No randomness, no network (spec §3.1).
 */
export function scoreEntry(entry: CatalogEntry, tokens: string[]): number {
  const nameTokens = new Set(tokenize(entry.name));
  const descTokens = new Set(tokenize(entry.description));
  let score = 0;
  for (const t of tokens) {
    if (nameTokens.has(t)) score += 3;
    else if (descTokens.has(t)) score += 1;
    if (entry.domain === t) score += 2;
  }
  return score;
}

/** Minimal structural view of a zod def; covers both v3 (typeName) and v4 (type). */
interface ZodDefLike {
  type?: string;
  typeName?: string;
  innerType?: ZodTypeAny;
}

/** "name: string, prompt?: string" — compact args line for find_tools output. */
export function renderArgsSummary(shape: ZodRawShape): string {
  return Object.entries(shape)
    .map(([key, schema]) => {
      const s = schema as ZodTypeAny;
      const optional = typeof s.isOptional === "function" && s.isOptional();
      const def = (s as unknown as { _def?: ZodDefLike })._def;
      const inner = optional && def?.innerType ? def.innerType : s;
      const innerDef = (inner as unknown as { _def?: ZodDefLike })._def;
      const typeName = String(innerDef?.typeName ?? innerDef?.type ?? "unknown")
        .replace(/^Zod/, "")
        .toLowerCase();
      return `${key}${optional ? "?" : ""}: ${typeName}`;
    })
    .join(", ");
}

export class ToolCatalog {
  private entries = new Map<string, CatalogEntry>();
  private defs = new Map<string, ToolDefinition>();

  constructor(tools: Record<string, ToolDefinition>, domains: Record<string, string>) {
    for (const [name, def] of Object.entries(tools)) {
      if (META_TOOL_NAMES.includes(name)) continue;
      this.entries.set(name, {
        name,
        domain: domains[name] ?? "other",
        description: def.description,
        argsShape: def.args as ZodRawShape,
      });
      this.defs.set(name, def);
    }
  }

  get(name: string): { entry: CatalogEntry; def: ToolDefinition } | undefined {
    const entry = this.entries.get(name);
    const def = this.defs.get(name);
    return entry && def ? { entry, def } : undefined;
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  listDomains(): Array<{ domain: string; count: number }> {
    const counts = new Map<string, number>();
    for (const e of this.entries.values()) {
      counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }

  byDomain(domain: string): CatalogEntry[] {
    return [...this.entries.values()]
      .filter((e) => e.domain === domain)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  search(query: string, opts: { domain?: string; limit?: number } = {}): CatalogEntry[] {
    const tokens = tokenize(query);
    const limit = opts.limit ?? 8;
    const pool = opts.domain ? this.byDomain(opts.domain) : [...this.entries.values()];
    return pool
      .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .slice(0, limit)
      .map((r) => r.entry);
  }
}

/** Short system-prompt section teaching an agent how to use the catalog. */
export function renderCatalogPrimer(catalog: ToolCatalog): string {
  const domains = catalog
    .listDomains()
    .map((d) => `${d.domain} (${d.count})`)
    .join(", ");
  return [
    "## Tool catalog (find on demand with hera_find_tools)",
    "",
    `Beyond your native tools, ${catalog.names().length} Hera tools are available via dispatch.`,
    `Domains: ${domains}.`,
    "",
    'Use hera_find_tools({ query: "..." }) or hera_find_tools({ domain: "..." }) to discover tools,',
    'then hera_run_tool({ tool: "<name>", args: { ... } }) to invoke one. Arguments are validated;',
    "errors explain the expected schema.",
  ].join("\n");
}
