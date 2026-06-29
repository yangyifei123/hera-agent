import { tool } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";
import type { HeraMemory, PluginContext } from "../types.js";
import { MAX_RECALL_RESULTS, MAX_RESULT_PREVIEW_LENGTH } from "../constants.js";

const z = tool.schema;

// Infrastructure memory types (agent/team definition backups + team internals)
// that should not surface in a user's category-less hera_recall.
const INFRA_RECALL_TYPES = ["agent", "team", "team-message", "team-session", "team-memory"];

type MemoryCategory = Extract<
  HeraMemory["type"],
  | "session"
  | "skill"
  | "agent"
  | "team"
  | "distillation"
  | "preference"
  | "decision"
  | "pattern"
  | "fix"
  | "context"
>;

export function createMemoryTools(ctx: PluginContext) {
  const { store } = ctx;

  return {
    hera_remember: tool({
      description: "Store information in Hera's persistent memory.",
      args: {
        content: z.string().describe("Information to remember"),
        category: z
          .enum([
            "session",
            "skill",
            "agent",
            "team",
            "distillation",
            "preference",
            "decision",
            "pattern",
            "fix",
            "context",
          ])
          .describe("Category"),
      },
      async execute(args) {
        // Deterministic content-hash id so re-remembering identical content
        // collapses onto one entry (matches the auto-memory path's dedup).
        const normalized = args.content.toLowerCase().replace(/\s+/g, " ").trim();
        const hash = createHash("sha1")
          .update(`${args.category}:${normalized}`)
          .digest("hex")
          .slice(0, 12);
        await store.save({
          id: `memo-${hash}`,
          type: args.category as MemoryCategory,
          content: args.content,
          timestamp: Date.now(),
        });
        return `Remembered in ${args.category} memory.`;
      },
    }),

    hera_recall: tool({
      description: "Search Hera's persistent memory.",
      args: {
        query: z.string().describe("Search query"),
        category: z
          .enum([
            "session",
            "skill",
            "agent",
            "team",
            "distillation",
            "preference",
            "decision",
            "pattern",
            "fix",
            "context",
          ])
          .optional()
          .describe("Filter"),
        limit: z.number().optional().describe("Max results to return (default 10, max 50)"),
        since: z
          .number()
          .optional()
          .describe("Only return memories from this Unix timestamp onward"),
      },
      async execute(args) {
        // Clamp to [1, 50]: a non-positive limit must not silently drop results
        // (it previously flowed into Array.slice(0, negative) -> empty).
        const effectiveLimit =
          args.limit != null ? Math.max(1, Math.min(args.limit, 50)) : MAX_RECALL_RESULTS;
        const results = await store.search(
          args.query,
          args.category as MemoryCategory | undefined,
          {
            limit: effectiveLimit,
            since: args.since,
            // Without an explicit category, hide internal agent/team definition
            // backups so user knowledge recall isn't polluted by infrastructure.
            excludeTypes: args.category ? undefined : INFRA_RECALL_TYPES,
          }
        );
        if (results.length === 0) return "No matching memories found.";
        return results
          .slice(0, effectiveLimit)
          .map((m) => `[${m.type}] ${m.content.slice(0, MAX_RESULT_PREVIEW_LENGTH)}`)
          .join("\n---\n");
      },
    }),
  };
}
