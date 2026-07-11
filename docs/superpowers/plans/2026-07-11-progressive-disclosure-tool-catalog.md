# Progressive Disclosure + Tool Catalog Retrieval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents carry a 5-tool native hot set plus a searchable in-memory tool catalog (meta-dispatch) instead of ~75 tool schemas, and all three prompt paths (live injection, disk `.md`, plugin export) render the same compact skill manifest instead of full skill bodies.

**Architecture:** New first-class module `src/dispatch/` (ToolCatalog + policy + 2 meta-tools) wraps the merged tool map from `createAllTools()`; the `config` hook computes each agent's native allow/deny map from a per-agent hot set; a shared skill-manifest renderer replaces full-body embedding in `buildAgentPrompt` and both generators; exported plugins ship skill bodies as files with a generated namespaced loader tool.

**Tech Stack:** TypeScript (Bun), zod (already a dependency via `tool.schema`), bun:test. No new dependencies. No embeddings, no SQLite.

**Spec:** `docs/superpowers/specs/2026-07-11-progressive-disclosure-tool-catalog-design.md` (read it first; §2 authorization-vs-registration and §9 decision log are binding).

## Global Constraints

- NEVER touch the real OpenCode config root `C:\Users\Administrator\.config\opencode`. Any runtime experiment sets `HERA_CONFIG_ROOT` to a temp/sandbox dir.
- Use `heraLog()` (from `src/logger.js`), never `console.*`.
- Use `atomicWriteText()`/`atomicWriteJson()` (from `src/fs-utils.js`) for persisted files. (`AgentRegistry.register` already does — registry.ts:38.)
- Constants live in `src/constants.ts`; no hardcoded magic values.
- Tests are `bun:test`, colocated next to source (`src/**/*.test.ts`).
- Code and commit messages in English. Conventional Commits.
- Release gate must stay green: `bun run typecheck && bun run lint && bun run build && bun test && npm pack --dry-run`.
- Preserve `promptB64` round-trip parity: the raw author prompt (`def.prompt`) must never gain or lose embedded sections across create → persist → reload (guarded by `src/agents/registry.test.ts`).
- Authorization vs native registration (spec §2): the hot set (`nativeTools`) is a performance knob only. `def.tools` + `disabled_tools` remain the only authorization truth. `hera_run_tool` allows exactly what the native path would allow.

---

### Task 1: Domain-labeled tool merge

**Files:**
- Modify: `src/tools/index.ts` (whole file, currently 37 lines)
- Test: `src/tools/tool-domains.test.ts` (create)

**Interfaces:**
- Produces: `createAllToolsWithDomains(ctx: PluginContext): { tools: Record<string, ToolDefinition>; domains: Record<string, string> }` — `domains` maps tool name → domain slug. `createAllTools(ctx)` keeps its exact current signature/behavior (delegates).
- Domain slugs (14): `agent`, `skill`, `team`, `memory`, `evolution`, `system`, `package`, `workflow`, `task`, `loop`, `recovery`, `program`, `program-scaffold`, `command`.

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/tool-domains.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/tool-domains.test.ts`
Expected: FAIL — `createAllToolsWithDomains` is not exported.

Note: if the Proxy-stub ctx makes any factory throw at creation time, replace the offending stub with a minimal object literal providing the destructured properties — look at that factory's first lines to see what it destructures. Do NOT weaken the assertions.

- [ ] **Step 3: Rewrite `src/tools/index.ts`**

```ts
import type { PluginContext } from "../types.js";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { createAgentTools } from "./agent-tools.js";
import { createSkillTools } from "./skill-tools.js";
import { createTeamTools } from "./team-tools.js";
import { createMemoryTools } from "./memory-tools.js";
import { createEvolutionTools } from "./evolution-tools.js";
import { createSystemTools } from "./system-tools.js";
import { createPackageTools } from "./package-tools.js";
import { createWorkflowTools } from "./workflow-tools.js";
import { createTaskTools } from "./task-tools.js";
import { createLoopTools } from "./loop-tools.js";
import { createRecoveryTools } from "./recovery-tools.js";
import { createProgramTools } from "./program-tools.js";
import { createProgramScaffoldTools } from "./program-scaffold-tools.js";
import { createCommandTools } from "./command-tools.js";

const DOMAIN_FACTORIES: ReadonlyArray<
  readonly [string, (ctx: PluginContext) => Record<string, ToolDefinition>]
> = [
  ["agent", createAgentTools],
  ["skill", createSkillTools],
  ["team", createTeamTools],
  ["memory", createMemoryTools],
  ["evolution", createEvolutionTools],
  ["system", createSystemTools],
  ["package", createPackageTools],
  ["workflow", createWorkflowTools],
  ["task", createTaskTools],
  ["loop", createLoopTools],
  ["recovery", createRecoveryTools],
  ["program", createProgramTools],
  ["program-scaffold", createProgramScaffoldTools],
  ["command", createCommandTools],
];

/**
 * Merge all tool domains, preserving which domain each tool came from.
 * `domains` maps tool name -> domain slug; used by the dispatch catalog
 * (src/dispatch/) and the per-agent native-set computation.
 */
export function createAllToolsWithDomains(ctx: PluginContext): {
  tools: Record<string, ToolDefinition>;
  domains: Record<string, string>;
} {
  const tools: Record<string, ToolDefinition> = {};
  const domains: Record<string, string> = {};
  for (const [domain, factory] of DOMAIN_FACTORIES) {
    for (const [name, def] of Object.entries(factory(ctx))) {
      tools[name] = def;
      domains[name] = domain;
    }
  }
  const disabled = new Set(ctx.config.disabled_tools ?? []);
  if (disabled.size > 0) {
    for (const name of Object.keys(tools)) {
      if (disabled.has(name)) {
        delete tools[name];
        delete domains[name];
      }
    }
  }
  return { tools, domains };
}

export function createAllTools(ctx: PluginContext): Record<string, ToolDefinition> {
  return createAllToolsWithDomains(ctx).tools;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tools/tool-domains.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run targeted neighbors + commit**

Run: `bun test src/tools/ && bun run typecheck`
Expected: all existing tool tests still pass.

```bash
git add src/tools/index.ts src/tools/tool-domains.test.ts
git commit -m "feat(dispatch): domain-labeled tool merge (createAllToolsWithDomains)"
```

---

### Task 2: ToolCatalog (`src/dispatch/catalog.ts`)

**Files:**
- Create: `src/dispatch/catalog.ts`
- Test: `src/dispatch/catalog.test.ts`

**Interfaces:**
- Consumes: `{ tools, domains }` from Task 1.
- Produces:
  - `interface CatalogEntry { name: string; domain: string; description: string; argsShape: ZodRawShape }`
  - `class ToolCatalog { constructor(tools, domains); get(name): { entry: CatalogEntry; def: ToolDefinition } | undefined; names(): string[]; listDomains(): Array<{ domain: string; count: number }>; byDomain(domain: string): CatalogEntry[]; search(query: string, opts?: { domain?: string; limit?: number }): CatalogEntry[] }`
  - `tokenize(text: string): string[]`, `scoreEntry(entry, tokens): number` (exported for tests)
  - `renderArgsSummary(shape: ZodRawShape): string`
  - `renderCatalogPrimer(catalog: ToolCatalog): string`
- Constructor MUST skip `hera_find_tools`/`hera_run_tool` if present (import `META_TOOL_NAMES` from `./policy.js` — Task 3 defines it; for this task define it locally in `catalog.ts` as `const META_TOOL_NAMES = ["hera_find_tools", "hera_run_tool"]` and move the import in Task 3).

- [ ] **Step 1: Write the failing test**

```ts
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
    tool({ description, args: args as never, async execute() { return "ok"; } });
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
    expect(catalog.search("agent", { domain: "team" }).every((e) => e.domain === "team")).toBe(true);
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
    const nameEntry = { name: "hera_create_agent", domain: "agent", description: "x", argsShape: {} };
    const descEntry = { name: "hera_x", domain: "agent", description: "create agent", argsShape: {} };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dispatch/catalog.test.ts`
Expected: FAIL — module `./catalog.js` not found.

- [ ] **Step 3: Implement `src/dispatch/catalog.ts`**

```ts
// src/dispatch/catalog.ts
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ZodRawShape, ZodTypeAny } from "zod";

/** Kept in sync with policy.ts (Task 3 switches this to an import). */
const META_TOOL_NAMES = ["hera_find_tools", "hera_run_tool"];

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

/** "name: string, prompt?: string" — compact args line for find_tools output. */
export function renderArgsSummary(shape: ZodRawShape): string {
  return Object.entries(shape)
    .map(([key, schema]) => {
      const s = schema as ZodTypeAny;
      const optional = typeof s.isOptional === "function" && s.isOptional();
      const inner = optional && s._def?.innerType ? s._def.innerType : s;
      const typeName = String(inner._def?.typeName ?? "unknown")
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dispatch/catalog.test.ts`
Expected: PASS. If `renderArgsSummary` fails on the optional-unwrap, inspect the zod version's `_def` layout (`bun repl` → `z.string().optional()._def`) and adjust the `innerType` access — the test's expected string is the contract, not the introspection detail.

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/catalog.ts src/dispatch/catalog.test.ts
git commit -m "feat(dispatch): in-memory ToolCatalog with deterministic keyword search"
```

---

### Task 3: Dispatch policy (`src/dispatch/policy.ts`)

**Files:**
- Create: `src/dispatch/policy.ts`
- Modify: `src/dispatch/catalog.ts` (replace local `META_TOOL_NAMES` with import)
- Modify: `src/constants.ts` (append constants)
- Test: `src/dispatch/policy.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition`, `HeraConfig` from `src/types.ts`.
- Produces:
  - `META_TOOL_NAMES: readonly string[]` = `["hera_find_tools", "hera_run_tool"]`
  - `type DenyReason = "meta-tool" | "disabled-tools" | "agent-tools-map"`
  - `interface PolicyDecision { allowed: boolean; reason?: DenyReason }`
  - `checkDispatch(toolName: string, agentName: string, deps: { registeredAgents: Map<string, AgentDefinition>; config: HeraConfig }): PolicyDecision`
  - `buildNativeToolsMap(opts: { hotSet: readonly string[]; heraToolNames: string[]; defTools?: Record<string, boolean> }): Record<string, boolean>`
  - `computeHeraHotSet(domains: Record<string, string>): string[]`
- In `src/constants.ts`:
  - `export const DEFAULT_CHILD_NATIVE_TOOLS = ["hera_find_tools", "hera_run_tool", "hera_load_skill", "hera_remember", "hera_recall"] as const;`
  - `export const HERA_NATIVE_DOMAINS = ["agent", "skill", "team"] as const;`

- [ ] **Step 1: Write the failing test**

```ts
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
    expect(checkDispatch("hera_create_agent", "child1", deps(agent(), ["hera_create_agent"]))).toEqual({
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dispatch/policy.test.ts`
Expected: FAIL — module `./policy.js` not found.

- [ ] **Step 3: Add constants, implement policy, fix catalog import**

Append to `src/constants.ts` (near `DEFAULT_SKILLS`, ~line 56):

```ts
// === Progressive disclosure / tool catalog ===

/** Tools every child agent keeps natively registered (full schema in context). */
export const DEFAULT_CHILD_NATIVE_TOOLS = [
  "hera_find_tools",
  "hera_run_tool",
  "hera_load_skill",
  "hera_remember",
  "hera_recall",
] as const;

/** Tool domains Hera itself keeps natively registered (factory core). */
export const HERA_NATIVE_DOMAINS = ["agent", "skill", "team"] as const;
```

Create `src/dispatch/policy.ts`:

```ts
// src/dispatch/policy.ts
import type { AgentDefinition, HeraConfig } from "../types.js";
import { DEFAULT_CHILD_NATIVE_TOOLS, HERA_NATIVE_DOMAINS } from "../constants.js";

/** The two dispatch meta-tools; never themselves dispatchable. */
export const META_TOOL_NAMES: readonly string[] = ["hera_find_tools", "hera_run_tool"];

export type DenyReason = "meta-tool" | "disabled-tools" | "agent-tools-map";

export interface PolicyDecision {
  allowed: boolean;
  reason?: DenyReason;
}

/**
 * Authorization check for dispatched calls — mirrors exactly what the native
 * path would allow (spec §2): agent tools map + disabled_tools. The hot set
 * plays no role here; it only affects native registration.
 */
export function checkDispatch(
  toolName: string,
  agentName: string,
  deps: { registeredAgents: Map<string, AgentDefinition>; config: HeraConfig }
): PolicyDecision {
  if (META_TOOL_NAMES.includes(toolName)) return { allowed: false, reason: "meta-tool" };
  if (deps.config.disabled_tools?.includes(toolName)) {
    return { allowed: false, reason: "disabled-tools" };
  }
  const def = deps.registeredAgents.get(agentName);
  if (def?.tools?.[toolName] === false) return { allowed: false, reason: "agent-tools-map" };
  return { allowed: true };
}

/**
 * Per-agent OpenCode `tools` allow/deny map: enable hotSet ∪ meta-tools,
 * explicitly deny every other hera_* tool, pass non-hera entries through.
 * Authorization denies (def.tools[t] === false) always win.
 */
export function buildNativeToolsMap(opts: {
  hotSet: readonly string[];
  heraToolNames: string[];
  defTools?: Record<string, boolean>;
}): Record<string, boolean> {
  const hot = new Set<string>([...opts.hotSet, ...META_TOOL_NAMES]);
  const map: Record<string, boolean> = {};
  for (const name of opts.heraToolNames) {
    map[name] = hot.has(name) && opts.defTools?.[name] !== false;
  }
  map["hera_find_tools"] = opts.defTools?.["hera_find_tools"] !== false;
  map["hera_run_tool"] = opts.defTools?.["hera_run_tool"] !== false;
  for (const [k, v] of Object.entries(opts.defTools ?? {})) {
    if (!(k in map)) map[k] = v;
    else if (v === false) map[k] = false;
  }
  return map;
}

/** Hera's default hot set: child defaults ∪ every tool in the factory-core domains. */
export function computeHeraHotSet(domains: Record<string, string>): string[] {
  const coreDomains = new Set<string>(HERA_NATIVE_DOMAINS);
  const fromDomains = Object.entries(domains)
    .filter(([, d]) => coreDomains.has(d))
    .map(([name]) => name);
  return [...new Set([...DEFAULT_CHILD_NATIVE_TOOLS, ...fromDomains])];
}
```

In `src/dispatch/catalog.ts`, delete the local `const META_TOOL_NAMES = [...]` and add:

```ts
import { META_TOOL_NAMES } from "./policy.js";
```

(No cycle: policy.ts does not import catalog.ts.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/dispatch/`
Expected: PASS (catalog + policy).

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/policy.ts src/dispatch/policy.test.ts src/dispatch/catalog.ts src/constants.ts
git commit -m "feat(dispatch): authorization policy + native-set computation"
```

---

### Task 4: Meta-tools (`src/dispatch/meta-tools.ts`)

**Files:**
- Create: `src/dispatch/meta-tools.ts`
- Test: `src/dispatch/meta-tools.test.ts`

**Interfaces:**
- Consumes: `ToolCatalog` (Task 2), `checkDispatch` (Task 3).
- Produces: `createDispatchTools(deps: { catalog: ToolCatalog; registeredAgents: Map<string, AgentDefinition>; config: HeraConfig }): Record<string, ToolDefinition>` returning exactly `{ hera_find_tools, hera_run_tool }`.
- Error contract (spec §7): every failure returns a string starting with `Error:`; the dispatcher never throws.

- [ ] **Step 1: Write the failing test**

```ts
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
    const out = String(await hera_run_tool.execute({ tool: "hera_create_agnet", args: {} } as never, ctx));
    expect(out).toStartWith("Error:");
    expect(out).toContain("hera_create_agent");
  });

  it("denied by agent tools map: names the denying layer", async () => {
    const { hera_run_tool } = fixture({ tools: { hera_create_agent: false } });
    const out = String(await hera_run_tool.execute({ tool: "hera_create_agent", args: { name: "x" } } as never, ctx));
    expect(out).toStartWith("Error:");
    expect(out).toContain("agent's tools map");
    expect(calls).toHaveLength(0);
  });

  it("invalid args: lists zod issues and the expected schema", async () => {
    const { hera_run_tool } = fixture();
    const out = String(await hera_run_tool.execute({ tool: "hera_create_agent", args: {} } as never, ctx));
    expect(out).toStartWith("Error:");
    expect(out).toContain("name");
    expect(out).toContain("name: string");
    expect(calls).toHaveLength(0);
  });

  it("target throws: caught and reported, never propagated", async () => {
    const { hera_run_tool } = fixture();
    const out = String(await hera_run_tool.execute({ tool: "hera_explode", args: {} } as never, ctx));
    expect(out).toStartWith("Error:");
    expect(out).toContain("hera_explode");
    expect(out).toContain("boom");
  });

  it("meta-tool self-dispatch is refused", async () => {
    const { hera_run_tool } = fixture();
    const out = String(await hera_run_tool.execute({ tool: "hera_run_tool", args: {} } as never, ctx));
    expect(out).toStartWith("Error:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dispatch/meta-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/dispatch/meta-tools.ts`**

```ts
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
        args: zs.record(zs.any()).optional().describe("Arguments for the target tool"),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/dispatch/`
Expected: PASS. If `zs.record(zs.any())` mis-parses under the repo's zod version, use `zs.any().optional()` for the `args` arg instead — the target-side `safeParse` is the real validation.

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/meta-tools.ts src/dispatch/meta-tools.test.ts
git commit -m "feat(dispatch): hera_find_tools + hera_run_tool with full permission parity"
```

---

### Task 5: Startup wiring (`src/index.ts`)

**Files:**
- Modify: `src/index.ts:263` (tool map construction) and imports.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: module-level (plugin-scope) `catalog: ToolCatalog`, `toolDomains: Record<string, string>`, `heraToolNames: string[]`, `catalogPrimer: string` — used by Task 7's config hook edit. Merged `tools` map now includes the 2 meta-tools.

- [ ] **Step 1: Replace the tool construction** (currently `const tools = createAllTools(ctx);` at `src/index.ts:263`)

```ts
const { tools: baseTools, domains: toolDomains } = createAllToolsWithDomains(ctx);
const catalog = new ToolCatalog(baseTools, toolDomains);
const dispatchTools = createDispatchTools({ catalog, registeredAgents, config });
// disabled_tools already filtered inside createAllToolsWithDomains; apply the
// same filter to the meta-tools so users can disable dispatch entirely.
const disabledToolNames = new Set(config.disabled_tools ?? []);
const tools = Object.fromEntries(
  Object.entries({ ...baseTools, ...dispatchTools }).filter(([n]) => !disabledToolNames.has(n))
);
```

(`toolDomains` is consumed by the `ToolCatalog` constructor here and again by Task 7 — no unused variable. Do NOT create `catalogPrimer`/`heraToolNames` in this task; Task 7 adds them where they are consumed, keeping typecheck/lint green at every commit.)

Imports to add at the top of `src/index.ts`:

```ts
import { createAllToolsWithDomains } from "./tools/index.js";
import { ToolCatalog } from "./dispatch/catalog.js";
import { createDispatchTools } from "./dispatch/meta-tools.js";
```

(Keep the existing `createAllTools` import only if still referenced; otherwise remove it.)

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun test src/dispatch/ src/tools/`
Expected: PASS with no unused-variable diagnostics.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(dispatch): build tool catalog + register meta-tools at startup"
```

---

### Task 6: `nativeTools` field round-trip

**Files:**
- Modify: `src/types.ts:235` (AgentDefinition)
- Modify: `src/agents/registry.ts` — `buildFrontmatter` (after line 196) and `parseMarkdownAgent` (fields block ~229–249, return object ~251–268)
- Modify: `bin/hera.js` — `buildAgentMarkdown` (~line 156, next to `skillsJson`)
- Test: extend `src/agents/registry.test.ts` (the round-trip test at lines 22–77)

**Interfaces:**
- Produces: `AgentDefinition.nativeTools?: string[]` — persisted as `nativeToolsJson` frontmatter; parsed with the existing `isStringArray` guard (registry.ts:314).

- [ ] **Step 1: Extend the failing test** — in `src/agents/registry.test.ts`, add to the fully-populated `def` in "persists custom skills, tools, permission, evolution log, and workflow" (lines 23–52):

```ts
nativeTools: ["hera_find_tools", "hera_run_tool", "hera_load_skill", "hera_run_task"],
```

and among the assertions (near lines 70–76):

```ts
expect(read!.nativeTools).toEqual(def.nativeTools);
```

Also add one new test in the same describe block:

```ts
it("omits nativeToolsJson when the field is unset and parses back undefined", async () => {
  const def = makeDef({ name: "no-native" }); // reuse this file's existing def factory/helper
  await registry.register(def, skillsMap);
  const read = await registry.load("no-native");
  expect(read!.nativeTools).toBeUndefined();
});
```

(Adapt helper names — `makeDef`/`skillsMap`/`registry.load` — to what the test file actually uses; read its first 30 lines. The assertion contract is what matters.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/agents/registry.test.ts`
Expected: FAIL — `read.nativeTools` is `undefined` vs expected array.

- [ ] **Step 3: Implement the three writers/parsers**

`src/types.ts` — inside `AgentDefinition` (after `workflow?` at line 235):

```ts
/** Tools natively registered (full schema in context). Performance knob only —
 *  authorization stays with `tools` + disabled_tools. Default: DEFAULT_CHILD_NATIVE_TOOLS. */
nativeTools?: string[];
```

`src/agents/registry.ts` — in `buildFrontmatter`, mirror the `skillsJson` line (after line 196):

```ts
if (def.nativeTools && def.nativeTools.length > 0) {
  lines.push(`nativeToolsJson: ${jsonFrontmatter(def.nativeTools)}`);
}
```

In `parseMarkdownAgent`, next to the other JSON fields:

```ts
const parsedNativeTools = parseJsonField<string[]>(get("nativeToolsJson"), isStringArray);
```

and in the returned `AgentDefinition` object:

```ts
...(parsedNativeTools ? { nativeTools: parsedNativeTools } : {}),
```

`bin/hera.js` — in `buildAgentMarkdown` next to the `skillsJson` line (~156):

```js
if (def.nativeTools && def.nativeTools.length > 0) {
  lines.push(`nativeToolsJson: ${jsonFrontmatter(def.nativeTools)}`);
}
```

Also align the CLI body's skill section (bin/hera.js:163-170, currently `"## Built-in Skills"` + `"This agent inherits: ..."`) with the shared manifest form (spec §5 CLI parity — the CLI has no skill descriptions, so it lists names only, but header + instruction match the runtime renderer):

```js
`# Agent: ${def.name}`,
"",
def.prompt,
"",
"## Skills (load on demand with hera_load_skill)",
"",
...def.skills.map((s) => `- ${s}`),
"",
"Call hera_load_skill(name) to load a skill's full guidance when it is relevant to the task.",
```

(Body is cosmetic — `promptB64` wins on reload — but keeping the section header identical means grep/docs describe one format.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/agents/registry.test.ts src/persistence.test.ts`
Expected: PASS (persistence flows `nativeTools` automatically via `JSON.stringify(def)`).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/agents/registry.ts bin/hera.js src/agents/registry.test.ts
git commit -m "feat(agents): nativeTools hot-set field with frontmatter round-trip"
```

---### Task 7: Config-hook native-set enforcement + catalog primer

**Files:**
- Modify: `src/index.ts` config hook (lines 266–349: hera injection at 270–273, child loop at 276–348)

**Interfaces:**
- Consumes: `buildNativeToolsMap`, `computeHeraHotSet` (Task 3), `catalogPrimer`, `heraToolNames`, `toolDomains` (Task 5), `DEFAULT_CHILD_NATIVE_TOOLS` (constants).
- Produces: every injected agent config carries (a) a `tools` map enabling exactly hot set ∪ meta-tools minus authorization denies, (b) the catalog primer appended to its prompt.

- [ ] **Step 0: Create the two derived values** — immediately after the Task 5 tool-map block (module scope, before `const hooks`):

```ts
const heraToolNames = Object.keys(tools).filter((n) => n.startsWith("hera_"));
const catalogPrimer = renderCatalogPrimer(catalog);
```

Add `renderCatalogPrimer` to the existing `./dispatch/catalog.js` import.

- [ ] **Step 1: Edit the hera injection** (`src/index.ts:270-273`) to:

```ts
// Inject Hera itself — with its factory-core hot set and the catalog primer.
const configInput = input as ConfigWithAgents;
configInput.agent = configInput.agent ?? {};
const heraCfg = createHeraAgent(model, skills);
heraCfg.prompt = [heraCfg.prompt, catalogPrimer].filter(Boolean).join("\n\n");
heraCfg.tools = buildNativeToolsMap({
  hotSet: computeHeraHotSet(toolDomains),
  heraToolNames,
});
configInput.agent["hera"] = heraCfg;
```

(If `AgentConfig`'s type lacks `tools`/`prompt` as mutable fields, follow how `createChildAgentConfig` declares them — `src/agents/hera.ts:263-272` — and widen the local type, not the shared one.)

- [ ] **Step 2: Edit the child injection loop** — inside the `try` block, after `fullPrompt` is assembled (currently line 316-318), change the assembly and the `createChildAgentConfig` call (lines 320-327) to:

```ts
const fullPrompt = [def.prompt, skillPrompts, teamBlock, evolutionBlock, catalogPrimer]
  .filter((part) => part.trim().length > 0)
  .join("\n\n");

const hotSet = def.nativeTools ?? [...DEFAULT_CHILD_NATIVE_TOOLS];
const nativeMap = buildNativeToolsMap({
  hotSet,
  heraToolNames,
  defTools: def.tools,
});

const childConfig = createChildAgentConfig(
  name,
  def.description,
  fullPrompt,
  def.model ?? model,
  def.mode as import("./types.js").AgentMode,
  { permission: def.permission, tools: nativeMap, maxSteps: def.maxSteps }
);
```

Leave the `catch` fallback path (lines 329–347) passing `tools: def.tools` unchanged — a corrupt definition should degrade to today's behavior, not to a half-computed native map.

Imports to add:

```ts
import { buildNativeToolsMap, computeHeraHotSet } from "./dispatch/policy.js";
import { DEFAULT_CHILD_NATIVE_TOOLS } from "./constants.js";
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun test`
Expected: green. The full suite matters here because the config hook touches every agent path.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(dispatch): per-agent native tool sets + catalog primer in injected prompts"
```

---

### Task 8: Shared skill-manifest section (parameterized loader)

**Files:**
- Modify: `src/skills/manager.ts` (near `SKILL_DISCLOSURE_INSTRUCTION`, lines 35–50, and `describeSkills`, lines 272–283)
- Modify: `src/index.ts` config hook (skill manifest block, lines 284–298)
- Test: extend `src/skills/manager.test.ts` (or create `src/skills/manifest.test.ts` if no manager test exists)

**Interfaces:**
- Produces (in `src/skills/manager.ts`):
  - `makeDisclosureInstruction(loaderToolName: string): string`
  - `SKILL_DISCLOSURE_INSTRUCTION` (kept, now `= makeDisclosureInstruction("hera_load_skill")`)
  - `buildSkillManifestSection(summaries: Array<{ name: string; description: string }>, loaderToolName = "hera_load_skill"): string` — returns `""` for empty summaries; otherwise header `## Skills (load on demand with <loader>)` + manifest lines + instruction.
  - `SkillManager.skillSummaries(skillNames: string[]): Array<{ name: string; description: string }>` (extracted from `describeSkills`, which now delegates).

- [ ] **Step 1: Write the failing test**

```ts
// add to the skills manager test file
import { buildSkillManifestSection, makeDisclosureInstruction } from "./manager.js";

describe("buildSkillManifestSection", () => {
  const summaries = [
    { name: "caveman", description: "Ultra-compressed output" },
    { name: "memory", description: "Persist knowledge  across\nsessions" },
  ];

  it("renders header, one line per skill, and the loader instruction", () => {
    const s = buildSkillManifestSection(summaries);
    expect(s).toContain("## Skills (load on demand with hera_load_skill)");
    expect(s).toContain("- caveman: Ultra-compressed output");
    expect(s).toContain("- memory: Persist knowledge across sessions");
    expect(s).toContain("Call hera_load_skill(name)");
  });

  it("parameterizes the loader tool name (for exported plugins)", () => {
    const s = buildSkillManifestSection(summaries, "greek_load_skill");
    expect(s).toContain("## Skills (load on demand with greek_load_skill)");
    expect(s).toContain("Call greek_load_skill(name)");
    expect(s).not.toContain("hera_load_skill");
  });

  it("returns empty string for no skills", () => {
    expect(buildSkillManifestSection([])).toBe("");
  });
});

describe("makeDisclosureInstruction", () => {
  it("names the loader", () => {
    expect(makeDisclosureInstruction("x_load_skill")).toContain("x_load_skill(name)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/skills/`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement** in `src/skills/manager.ts`:

```ts
/** Loader-parameterized disclosure instruction (exports use a namespaced loader). */
export function makeDisclosureInstruction(loaderToolName: string): string {
  return `Call ${loaderToolName}(name) to load a skill's full guidance when it is relevant to the task.`;
}

export const SKILL_DISCLOSURE_INSTRUCTION = makeDisclosureInstruction("hera_load_skill");

/**
 * The one shared manifest section used by all three prompt paths (spec §5):
 * live config-hook injection, disk buildAgentPrompt, and plugin export.
 */
export function buildSkillManifestSection(
  summaries: Array<{ name: string; description: string }>,
  loaderToolName = "hera_load_skill"
): string {
  if (summaries.length === 0) return "";
  return [
    `## Skills (load on demand with ${loaderToolName})`,
    "",
    renderSkillManifest(summaries),
    "",
    makeDisclosureInstruction(loaderToolName),
  ].join("\n");
}
```

(Replace the existing `export const SKILL_DISCLOSURE_INSTRUCTION = "..."` at lines 39–40.)

Add to the `SkillManager` class, and make `describeSkills` delegate:

```ts
/** Name+description pairs for known skills (unknown names skipped). */
skillSummaries(skillNames: string[]): Array<{ name: string; description: string }> {
  return skillNames
    .map((name) => this.loadedSkills.get(name))
    .filter((s): s is SkillDefinition => s !== undefined)
    .map((s) => ({ name: s.name, description: s.description }));
}

describeSkills(skillNames: string[]): string {
  return renderSkillManifest(this.skillSummaries(skillNames));
}
```

- [ ] **Step 4: Switch the config hook** — replace `src/index.ts:284-298` (the inline manifest block) with:

```ts
// Progressive disclosure: compact skill manifest; full bodies load on demand
// via hera_load_skill. One shared renderer across live/disk/export (spec §5).
const skillPrompts = buildSkillManifestSection(
  skillManager.skillSummaries(getDefaultSkills(def.skills))
);
```

Imports: `buildSkillManifestSection` from `./skills/manager.js`, `getDefaultSkills` from `./helpers.js` (check both — `getDefaultSkills` may already be imported).

Note the deliberate behavior change: the manifest now covers `DEFAULT_SKILLS ∪ def.skills` (template-created agents previously missed defaults not in their list).

- [ ] **Step 5: Run tests + commit**

Run: `bun test src/skills/ && bun run typecheck && bun test`
Expected: green.

```bash
git add src/skills/manager.ts src/index.ts src/skills/*.test.ts
git commit -m "feat(skills): shared parameterized manifest section; config hook uses it"
```

---

### Task 9: `buildAgentPrompt` renders the manifest (kills the §4 sharp edge)

**Files:**
- Modify: `src/agents/hera.ts:275-343` (`buildAgentPrompt`)
- Modify: `src/agents/registry.ts:29-31` (resolve defaults union)
- Modify: `src/persistence.test.ts:203-243` (the "re-embedded" restore test asserts manifest now)
- Test: create `src/agents/prompt-parity.test.ts`

**Interfaces:**
- Produces: `buildAgentPrompt(def: AgentDefinition, resolvedSkills: SkillDefinition[], opts?: { loaderToolName?: string }): string` — body = `# Agent: <name>` + `def.prompt` + `buildSkillManifestSection(resolvedSkills summaries, loader)` + evolution block. NO full skill bodies, NO `## Built-in Skill:` sections.
- Consumers that must keep working unchanged: `registry.register` (registry.ts:33), both generators (plugin-generator.ts:261, team-plugin-generator.ts:178 — they pick up the manifest automatically; Task 11/12 add the loader name).

- [ ] **Step 1: Write the failing parity test**

```ts
// src/agents/prompt-parity.test.ts
import { describe, expect, it } from "bun:test";
import { buildAgentPrompt } from "./hera.js";
import { buildSkillManifestSection } from "../skills/manager.js";
import type { AgentDefinition, SkillDefinition } from "../types.js";

const skills: SkillDefinition[] = [
  { name: "caveman", description: "Ultra-compressed output", prompt: "FULL CAVEMAN BODY", category: "builtin" } as SkillDefinition,
  { name: "custom-x", description: "Does X", prompt: "FULL X BODY", category: "custom" } as SkillDefinition,
];

const def: AgentDefinition = {
  name: "parity-agent",
  description: "d",
  mode: "subagent",
  prompt: "You are parity-agent.",
  skills: ["caveman", "custom-x"],
};

describe("buildAgentPrompt (progressive)", () => {
  it("embeds the manifest, never full skill bodies", () => {
    const out = buildAgentPrompt(def, skills);
    expect(out).toContain("- caveman: Ultra-compressed output");
    expect(out).toContain("- custom-x: Does X");
    expect(out).not.toContain("FULL CAVEMAN BODY");
    expect(out).not.toContain("FULL X BODY");
    expect(out).not.toContain("## Built-in Skill:");
  });

  it("renders the IDENTICAL manifest section as the live config-hook path (§4 pinned)", () => {
    const section = buildSkillManifestSection(
      skills.map((s) => ({ name: s.name, description: s.description }))
    );
    expect(buildAgentPrompt(def, skills)).toContain(section);
  });

  it("parameterizes the loader for exports", () => {
    const out = buildAgentPrompt(def, skills, { loaderToolName: "greek_load_skill" });
    expect(out).toContain("greek_load_skill");
    expect(out).not.toContain("hera_load_skill");
  });

  it("keeps the evolution block", () => {
    const withEvo = { ...def, evolutionLog: [{ timestamp: 1700000000000, trigger: "t", observation: "o", directive: "Always test", rolledBack: false }] };
    expect(buildAgentPrompt(withEvo, skills)).toContain("Always test");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/agents/prompt-parity.test.ts`
Expected: FAIL — output contains `FULL CAVEMAN BODY` / `## Built-in Skill:`.

- [ ] **Step 3: Rewrite `buildAgentPrompt`** (hera.ts:275-343) to:

```ts
export function buildAgentPrompt(
  def: AgentDefinition,
  resolvedSkills: SkillDefinition[],
  opts: { loaderToolName?: string } = {}
): string {
  const sections: string[] = [];

  sections.push(`# Agent: ${def.name}`);
  sections.push("");
  sections.push(def.prompt);
  sections.push("");

  // Progressive disclosure (spec §5): compact manifest instead of full bodies.
  // The identical section is rendered by the live config hook and by exports;
  // src/agents/prompt-parity.test.ts pins the three paths together.
  const manifest = buildSkillManifestSection(
    resolvedSkills.map((s) => ({ name: s.name, description: s.description })),
    opts.loaderToolName
  );
  if (manifest) {
    sections.push(manifest);
    sections.push("");
  }

  if (def.evolutionLog && def.evolutionLog.length > 0) {
    sections.push(buildEvolutionBlock(def.evolutionLog));
    sections.push("");
  }

  return sections.join("\n");
}
```

Remove the 11 now-unused built-in prompt getter imports from hera.ts IF nothing else in the file uses them (grep the file first — templates may). Add `import { buildSkillManifestSection } from "../skills/manager.js";` (verify no import cycle: manager.ts must not import from agents/hera.ts — it doesn't today).

- [ ] **Step 4: Resolve the defaults union in `registry.register`** (registry.ts:29-31):

```ts
const resolvedSkills = getDefaultSkills(def.skills)
  .map((name) => skills.get(name))
  .filter((skill): skill is SkillDefinition => skill !== undefined);
```

Import `getDefaultSkills` from `../helpers.js`.

- [ ] **Step 5: Update the restore test** — `src/persistence.test.ts:203-243` ("restores markdown with custom skill prompts re-embedded"): rename to "restores markdown with the skill manifest re-rendered" and replace the `CUSTOM_SKILL_BODY`-in-file assertions with manifest assertions, e.g.:

```ts
expect(fileContent).toContain(`- ${CUSTOM_SKILL_NAME}:`);
expect(fileContent).not.toContain(CUSTOM_SKILL_BODY);
```

(Keep the structural flow of the test — create → persist → remove → restore → re-read — intact.)

- [ ] **Step 6: Run the affected suites**

Run: `bun test src/agents/ src/persistence.test.ts src/skills/`
Expected: PASS. Generator tests (`src/generators/`) will now FAIL on "full prompt assembly (P0)" markers — that is EXPECTED and fixed in Tasks 11–12; do not fix generator tests here.

- [ ] **Step 7: Commit**

```bash
git add src/agents/hera.ts src/agents/registry.ts src/agents/prompt-parity.test.ts src/persistence.test.ts
git commit -m "feat(agents): buildAgentPrompt renders shared skill manifest (fixes prompt drift)"
```

---

### Task 10: One-time startup migration of legacy agent `.md`

**Files:**
- Modify: `src/agents/registry.ts` (add `readAgentFile`)
- Modify: `src/persistence.ts` (add `migrateLegacyAgentMarkdown`)
- Modify: `src/index.ts` (call it after agents are loaded, ~line 242, before `const ctx`)
- Test: extend `src/persistence.test.ts`

**Interfaces:**
- Produces:
  - `AgentRegistry.readAgentFile(name: string): Promise<string | undefined>` — raw file content or undefined if missing.
  - `migrateLegacyAgentMarkdown(registeredAgents: Map<string, AgentDefinition>, skills: Map<string, SkillDefinition>, agentRegistry: AgentRegistry): Promise<string[]>` — returns migrated agent names. Legacy marker: body contains `"## Built-in Skill:"`. For each legacy file: `backupAgent(...)` then `agentRegistry.register(def, skills)` (register already uses `atomicWriteText`, registry.ts:38). Idempotent: rewritten files no longer contain the marker.

- [ ] **Step 1: Write the failing test** (in `src/persistence.test.ts`, inside the existing real-registry integration describe block that already builds `registry`/`store` on a tmpdir):

```ts
it("migrates legacy full-body agent markdown to manifest form, once", async () => {
  const def = makeAgentDef({ name: "legacy-agent" }); // reuse the file's existing def helper
  await persistAgent(def, skillsMap, registeredAgents, registry, store);

  // Forge a legacy file: inject a full-body skill section like pre-migration builds.
  const file = join(agentsDir, "legacy-agent.md");
  const current = await readFile(file, "utf-8");
  await writeFile(file, current + "\n## Built-in Skill: Caveman\nFULL LEGACY BODY\n");

  const migrated = await migrateLegacyAgentMarkdown(registeredAgents, skillsMap, registry);
  expect(migrated).toEqual(["legacy-agent"]);

  const after = await readFile(file, "utf-8");
  expect(after).not.toContain("## Built-in Skill:");
  // A backup snapshot exists.
  const backups = await listBackups("legacy-agent", registry);
  expect(backups.length).toBeGreaterThan(0);

  // Second run is a no-op.
  expect(await migrateLegacyAgentMarkdown(registeredAgents, skillsMap, registry)).toEqual([]);
});
```

(Adapt helper/fixture names to the file's existing ones — the integration block at persistence.test.ts:152-244 already has a real registry + store + tmpdir; `listBackups` signature is `listBackups(name, agentRegistry)` per persistence.ts:140-163 — verify and adapt.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/persistence.test.ts`
Expected: FAIL — `migrateLegacyAgentMarkdown` not exported.

- [ ] **Step 3: Implement**

`src/agents/registry.ts`:

```ts
/** Raw agent .md content, or undefined if the file is missing/unreadable. */
async readAgentFile(name: string): Promise<string | undefined> {
  try {
    return await readFile(join(this.agentsDir, `${name}.md`), "utf-8");
  } catch {
    return undefined;
  }
}
```

(`readFile`/`join` are already imported in registry.ts — verify.)

`src/persistence.ts`:

```ts
const LEGACY_BODY_MARKER = "## Built-in Skill:";

/**
 * One-time idempotent migration (spec §5): rewrite agent .md files that still
 * embed full skill bodies to the compact-manifest rendering. Backs up each
 * file first; register() writes atomically. Safe to run every startup — the
 * marker disappears after the first rewrite.
 */
export async function migrateLegacyAgentMarkdown(
  registeredAgents: Map<string, AgentDefinition>,
  skills: Map<string, SkillDefinition>,
  agentRegistry: AgentRegistry
): Promise<string[]> {
  const migrated: string[] = [];
  for (const [name, def] of registeredAgents) {
    try {
      const content = await agentRegistry.readAgentFile(name);
      if (!content || !content.includes(LEGACY_BODY_MARKER)) continue;
      await backupAgent(name, registeredAgents, agentRegistry);
      await agentRegistry.register(def, skills);
      migrated.push(name);
    } catch (err) {
      heraLog("warn", `Legacy prompt migration failed for agent "${name}"; leaving file as-is`, err);
    }
  }
  if (migrated.length > 0) {
    heraLog("info", `Migrated ${migrated.length} agent file(s) to manifest prompts: ${migrated.join(", ")}`);
  }
  return migrated;
}
```

`src/index.ts` — after the disk/memory agent loading completes (after line 242, before `const ctx`):

```ts
try {
  await migrateLegacyAgentMarkdown(registeredAgents, skillManager.getSkillMap(), agentRegistry);
} catch (err) {
  heraLog("warn", "Legacy agent markdown migration failed; continuing", err);
}
```

- [ ] **Step 4: Run tests + commit**

Run: `bun test src/persistence.test.ts src/agents/ && bun run typecheck`
Expected: PASS.

```bash
git add src/persistence.ts src/agents/registry.ts src/index.ts src/persistence.test.ts
git commit -m "feat(agents): idempotent startup migration of legacy full-body agent markdown"
```

---

### Task 11: Progressive single-agent exports (`plugin-generator.ts`)

**Files:**
- Modify: `src/generators/plugin-generator.ts` — `generatePluginIndex` (:255-450), `generatePackageJson` (:190), `generate` (:531-573)
- Modify: `src/generators/plugin-generator.test.ts` — "full prompt assembly (P0)" block + new assertions
- Consumes: `buildAgentPrompt(def, skills, { loaderToolName })` (Task 9), `BUILTIN_SKILLS` from `src/skills/manager.ts` (export it if not already exported — check; `isBuiltin` at manager.ts:256-258 references it).

**Interfaces:**
- Produces:
  - `toolSafeName(name: string): string` (exported) — `name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")`.
  - `generateSkillLoaderFragment(loaderToolName: string, skillNames: string[]): string` (exported) — emitted `tool()` registration reading `skills/<name>/SKILL.md`.
  - `PluginPackage.files` now includes one `skills/<skill>/SKILL.md` per shipped skill; `package.json` `files` array includes `"skills"`.
  - Loader tool name: `` `${toolSafeName(agent.name)}_load_skill` ``.

- [ ] **Step 1: Update/extend the failing tests** in `plugin-generator.test.ts`:

Replace the "full prompt assembly (P0)" body-marker assertions (e.g. `toContain("Caveman Mode")`) with:

```ts
it("bakes a manifest prompt, not skill bodies", () => {
  const code = gen.generatePluginIndex(agent, resolvedSkills);
  expect(code).toContain("## Skills (load on demand with");
  expect(code).not.toContain("## Built-in Skill:");
});

it("emits a namespaced skill loader + skills/ files", () => {
  const pkg = gen.generate(agent, resolvedSkills);
  const index = pkg.files.find((f) => f.path === "src/index.ts")!.content;
  expect(index).toContain("_load_skill: tool({");
  const skillFiles = pkg.files.filter((f) => f.path.startsWith("skills/"));
  expect(skillFiles.length).toBeGreaterThanOrEqual(11); // built-ins at minimum
  expect(skillFiles.some((f) => f.path === "skills/caveman/SKILL.md")).toBe(true);
  const pkgJson = JSON.parse(pkg.files.find((f) => f.path === "package.json")!.content);
  expect(pkgJson.files).toContain("skills");
});

it("the manifest instruction references the namespaced loader, not hera_load_skill", () => {
  const code = gen.generatePluginIndex(agent, resolvedSkills);
  expect(code).not.toContain("hera_load_skill");
});
```

(Keep evolution-directive assertions — evolution block survives. Adapt `gen`/`agent`/`resolvedSkills` to the file's fixtures.)

- [ ] **Step 2: Run to verify failures**

Run: `bun test src/generators/plugin-generator.test.ts`
Expected: FAIL on the new assertions (and possibly already-failing old marker assertions from Task 9).

- [ ] **Step 3: Implement**

In `src/skills/manager.ts`: ensure `export` on the `BUILTIN_SKILLS` array (top of file, ~line 20s).

In `plugin-generator.ts`:

```ts
import { BUILTIN_SKILLS } from "../skills/manager.js";
import type { SkillDefinition } from "../types.js";

/** Plugin-scoped identifier fragment for generated tool names. */
export function toolSafeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Union of built-in + resolved skills, deduped by name (resolved wins). */
export function collectExportSkills(resolvedSkills: SkillDefinition[]): SkillDefinition[] {
  const byName = new Map<string, SkillDefinition>();
  for (const s of BUILTIN_SKILLS) byName.set(s.name, s);
  for (const s of resolvedSkills) byName.set(s.name, s);
  return [...byName.values()];
}

/** Emitted-code fragment: a fs-reading skill loader tool (progressive exports, spec §6). */
export function generateSkillLoaderFragment(loaderToolName: string, skillNames: string[]): string {
  const known = skillNames.map((n) => JSON.stringify(n)).join(", ");
  return `
    ${loaderToolName}: tool({
      description: "Load the full guidance for one of this agent's skills (progressive disclosure).",
      args: { name: z.string().describe("Skill name from the manifest") },
      async execute(args) {
        const requested = String(args.name).toLowerCase().trim();
        const known = [${known}];
        if (!known.includes(requested)) {
          return \`Error: unknown skill "\${requested}". Available: \${known.join(", ")}.\`;
        }
        try {
          return await readFile(join(PLUGIN_ROOT, "skills", requested, "SKILL.md"), "utf-8");
        } catch {
          return \`Error: skill file missing for "\${requested}". Reinstall the plugin.\`;
        }
      },
    }),`;
}
```

In `generatePluginIndex` (:255):
1. Compute `const exportSkills = collectExportSkills(resolvedSkills);` and `const loaderToolName = `${toolSafeName(agent.name)}_load_skill`;`.
2. Change `:261` to `const fullPrompt = buildAgentPrompt(agent, exportSkills, { loaderToolName });`.
3. Add to the emitted template header (next to the existing imports the template already emits — find the emitted `import` lines): `import { readFile } from "node:fs/promises";`, `import { join, dirname } from "node:path";`, `import { fileURLToPath } from "node:url";` and the module-scope line `const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");` (dist/index.js sits one level below the package root; `skills/` sits at the root).
4. Insert `generateSkillLoaderFragment(loaderToolName, exportSkills.map((s) => s.name))` into the emitted `tool: { ... }` map (next to the `hera_remember` fragment at :408).

In `generatePackageJson` (:190): add `"skills"` to the `files` array.

In `generate` (:531): append skill files to the returned `PluginPackage.files`:

```ts
const exportSkills = collectExportSkills(resolvedSkills);
const skillFiles: PluginFile[] = exportSkills.map((s) => ({
  path: `skills/${s.name}/SKILL.md`,
  content: `# Skill: ${s.name}\n\n${s.description}\n\n${s.prompt}\n`,
}));
files.push(...skillFiles);
```

(`writeToDisk` at :578-597 already mkdirs parent dirs per file — no change needed.)

- [ ] **Step 4: Run tests**

Run: `bun test src/generators/plugin-generator.test.ts src/generators/command-fragment.test.ts src/generators/e2e-build.test.ts`
Expected: PASS. e2e-build actually compiles the emitted index with `bun build`, which supports `fileURLToPath(import.meta.url)` — if that step fails, diagnose the emitted code (read the temp dir's `src/index.ts`) before changing the PLUGIN_ROOT approach; do NOT fall back to `process.cwd()` (wrong once OpenCode loads the plugin from another directory).

- [ ] **Step 5: Commit**

```bash
git add src/generators/plugin-generator.ts src/generators/plugin-generator.test.ts src/skills/manager.ts
git commit -m "feat(export): progressive single-agent plugins (manifest + skills/ + namespaced loader)"
```

---

### Task 12: Progressive team exports (`team-plugin-generator.ts`)

**Files:**
- Modify: `src/generators/team-plugin-generator.ts` — `generatePluginIndex` (:156-330), `generatePackageJson` (:120), `generate` (:378-405)
- Modify: `src/generators/team-plugin-generator.test.ts`

**Interfaces:**
- Consumes: `toolSafeName`, `collectExportSkills`, `generateSkillLoaderFragment` from `./plugin-generator.js` (Task 11).
- Produces: ONE loader per team plugin named `` `${toolSafeName(team.name)}_load_skill` ``; every member's baked prompt references that loader; `skills/` = union over ALL members' resolved skills + built-ins.

- [ ] **Step 1: Update/extend failing tests** in `team-plugin-generator.test.ts` — replace the "11 built-in skills" body-marker assertions with manifest assertions; add:

```ts
it("emits one team-scoped loader and a shared skills/ dir", () => {
  const pkg = gen.generate(team, members, resolvedSkills);
  const index = pkg.files.find((f) => f.path === "src/index.ts")!.content;
  const loaderMatches = index.match(/_load_skill: tool\(\{/g) ?? [];
  expect(loaderMatches).toHaveLength(1);
  expect(index).toContain(`${team.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_load_skill`);
  expect(pkg.files.some((f) => f.path === "skills/caveman/SKILL.md")).toBe(true);
  expect(index).not.toContain("hera_load_skill");
});
```

- [ ] **Step 2: Run to verify failures**

Run: `bun test src/generators/team-plugin-generator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `generatePluginIndex` (:156): compute `loaderToolName` from the team name once; change the per-member call at `:178` to `buildAgentPrompt(augmented, exportSkills, { loaderToolName })` (where `exportSkills = collectExportSkills(resolvedSkills)`); emit the loader fragment once next to `MEMORY_TOOL_BLOCK` (:323-324) plus the same emitted-header imports/`PLUGIN_ROOT` as Task 11. In `generatePackageJson` (:120): add `"skills"`. In `generate` (:378): append the same `skillFiles` block as Task 11.

- [ ] **Step 4: Run tests + full generator suite**

Run: `bun test src/generators/`
Expected: PASS, including e2e-build for teams.

- [ ] **Step 5: Commit**

```bash
git add src/generators/team-plugin-generator.ts src/generators/team-plugin-generator.test.ts
git commit -m "feat(export): progressive team plugins share one namespaced skill loader"
```

---

### Task 13: Documentation (README, GitHub display page, CLAUDE.md, ARCHITECTURE.md)

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `docs/SHOWCASE.md` (if it demos prompts/tools)

**Interfaces:** none (docs). The GitHub display page IS `README.md` (repo front page) — user explicitly requested it reflect this feature.

- [ ] **Step 1: README.md** — add a "Progressive disclosure & tool catalog" section covering: the 5-tool child hot set + `hera_find_tools`/`hera_run_tool` usage; `nativeTools` per-agent override; authorization vs registration in one paragraph (hot set is a performance knob; `tools` map + `disabled_tools` remain authorization); exported plugins ship `skills/<name>/SKILL.md` + a `<plugin>_load_skill` loader. Update any tool-count/domain claims to 14 domains. Update the exported-plugin section to mention the `skills` files entry.

- [ ] **Step 2: CLAUDE.md** — rewrite §4 ("Prompt assembly is a sharp edge") to describe the new invariant: all three paths render `buildSkillManifestSection` and `src/agents/prompt-parity.test.ts` pins them; update §7 tool domains 11 → 14 + add the dispatch meta-tools; add `src/dispatch/` to the architecture overview and the startup flow (catalog build step). Update the "11 built-in skills" phrasing where it implies full-body embedding.

- [ ] **Step 3: ARCHITECTURE.md** — add a `src/dispatch/` module section (catalog/policy/meta-tools, data flow diagram from spec §3).

- [ ] **Step 4: Verify docs claims** — grep the docs for "27KB", "11 domains", "embedded skills", "Tool RAG" and correct every stale claim. `docs/MODES.md`/`docs/CANONICAL_DEMO.md`: update only if they show full-body prompts.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md ARCHITECTURE.md docs/
git commit -m "docs: progressive disclosure + tool catalog (README, CLAUDE.md, ARCHITECTURE)"
```

---

### Task 14: Full gate + isolated smoke verification

**Files:** none new (verification only). Optional scratch script under the session scratchpad dir — NOT committed.

- [ ] **Step 1: Full release gate**

Run: `bun run typecheck && bun run lint && bun run build && bun test && npm pack --dry-run`
Expected: all green; pack lists `dist/engine/index.js` (regression guard from `src/release-manifest.test.ts`).

- [ ] **Step 2: Isolated end-to-end smoke** (sandbox only — `HERA_CONFIG_ROOT` to a temp dir, NEVER the real `~/.config/opencode`):

Write a scratch bun script that (a) constructs the real `SkillManager`/`AgentRegistry`/`MemoryStore` on the sandbox root, (b) persists an agent via `persistAgent`, (c) asserts the written `.md` contains `## Skills (load on demand with hera_load_skill)` and not `## Built-in Skill:`, (d) builds `createAllToolsWithDomains` + `ToolCatalog` + `createDispatchTools` with the real context, (e) invokes `hera_find_tools({query:"create agent"})` and `hera_run_tool({tool:"hera_list_skills",args:{}})` with a fake `ToolContext` (`{agent:"hera", sessionID:"smoke", ...}`), asserting sensible output; (f) exports the agent via `PluginGenerator.generate` + `writeToDisk` to the sandbox and asserts `skills/caveman/SKILL.md` exists on disk.

Expected: every assertion passes; the real config root untouched (spot-check `C:\Users\Administrator\.config\opencode\agents\hera` mtimes unchanged).

- [ ] **Step 3: Verify context-savings claim** — print the byte length of a persisted agent `.md` before/after (compare to a pre-migration backup): expect roughly 27KB → ~2KB for a default agent. Record actual numbers in the final report.

- [ ] **Step 4: Commit any test-only fixes, then final gate re-run**

```bash
git status   # must be clean or only intentional changes
```

---

## Task dependency order

1 → 2 → 3 → 4 → 5 (dispatch spine, strictly sequential)
6 (independent of 1–5; needed by 7)
7 (needs 3, 5, 6)
8 (independent; needed by 9)
9 (needs 8) → 10 (needs 9)
11 (needs 9) → 12 (needs 11)
13, 14 last.

Parallelizable groups for orchestration: {6, 8} may run alongside {2, 3, 4}; 11 and 10 may run in parallel (disjoint files); everything else sequential as listed. Implementers run ONLY their task's targeted tests; the controller runs the full gate.
