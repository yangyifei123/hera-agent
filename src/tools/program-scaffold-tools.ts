// src/tools/program-scaffold-tools.ts
import { tool } from "@opencode-ai/plugin";
import type { PluginContext, SkillPackage } from "../types.js";
import { HERA_SDK_DTS, RUN_TS_TEMPLATE } from "../program/sdk-types.js";

const z = tool.schema;

export function createProgramScaffoldTools(ctx: PluginContext) {
  return {
    hera_create_program_skill: tool({
      description:
        "Scaffold a new program-led skill: a directory with SKILL.json (program: run.ts), a typed run.ts entry, and hera-sdk.d.ts for autocomplete.",
      args: {
        name: z.string().describe("Skill name (kebab-case)"),
        description: z.string().describe("What the program does"),
      },
      async execute(args) {
        const pkg: SkillPackage = {
          name: args.name,
          description: args.description,
          trigger: "",
          category: "user",
          program: "run.ts",
          prompt: "",
          config: {},
          files: [
            { path: "run.ts", content: RUN_TS_TEMPLATE },
            { path: "hera-sdk.d.ts", content: HERA_SDK_DTS },
          ],
        };
        try {
          await ctx.skillManager.createSkill(pkg);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        return `Program skill "${args.name}" scaffolded (run.ts + hera-sdk.d.ts). Run it with hera_run_program({ skill: "${args.name}" }).`;
      },
    }),
  };
}
