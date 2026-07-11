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
