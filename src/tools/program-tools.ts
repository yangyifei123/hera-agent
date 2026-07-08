// src/tools/program-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";

const z = tool.schema;

export function createProgramTools(ctx: PluginContext) {
  return {
    hera_run_program: tool({
      description:
        "Run a program-led skill (one that ships a run.ts). Executes in a sandboxed child process; deterministic steps run in the child and llm steps run through Hera. Returns the program's structured result.",
      args: {
        skill: z.string().describe("Name of the program skill to run"),
        args: z.any().optional().describe("Arguments passed to the program's run(hera, args)"),
      },
      async execute(args, context) {
        const result = await ctx.programRunner.run(args.skill, args.args, {
          sessionID: context.sessionID,
          directory: context.directory,
        });
        const logs = result.logs.length ? `\nLogs:\n${result.logs.join("\n")}` : "";
        if (result.ok) {
          return `Program ${args.skill} succeeded.\nResult: ${JSON.stringify(result.value)}${logs}`;
        }
        return `Program ${args.skill} failed: ${result.error}${logs}`;
      },
    }),
  };
}
