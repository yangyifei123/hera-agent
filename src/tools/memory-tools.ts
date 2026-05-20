import { tool } from "@opencode-ai/plugin";
import { randomUUID } from "node:crypto";
import type { PluginContext } from "../types.js";
import { MAX_RECALL_RESULTS, MAX_RESULT_PREVIEW_LENGTH } from "../constants.js";

const z = tool.schema;

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
        await store.save({
          id: `memo-${randomUUID().slice(0, 8)}`,
          type: args.category as any,
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
        const effectiveLimit = args.limit != null ? Math.min(args.limit, 50) : MAX_RECALL_RESULTS;
        const results = await store.search(args.query, args.category as any, {
          limit: effectiveLimit,
          since: args.since,
        });
        if (results.length === 0) return "No matching memories found.";
        return results
          .slice(0, effectiveLimit)
          .map((m) => `[${m.type}] ${m.content.slice(0, MAX_RESULT_PREVIEW_LENGTH)}`)
          .join("\n---\n");
      },
    }),
  };
}
