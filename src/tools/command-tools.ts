// src/tools/command-tools.ts
import { tool } from "@opencode-ai/plugin";
import { join } from "node:path";
import { readdir, unlink } from "node:fs/promises";
import type { PluginContext } from "../types.js";
import {
  buildCommandMarkdown,
  writeCommandFile,
  validateCommandName,
} from "../commands/command-file.js";
import { errorMessage } from "../helpers.js";

const z = tool.schema;

/**
 * Tools for managing OpenCode native slash-command files
 * (`<configRoot>/command/<name>.md`). These are the keyword-command primitive
 * omo-style plugins use to ship `/<name>`-triggered agents. All writes go to
 * `ctx.paths.configRoot` (the resolved OpenCode config root, honoring
 * `HERA_CONFIG_ROOT`), so a sandboxed root keeps them out of a live install.
 */
export function createCommandTools(ctx: PluginContext) {
  const commandDir = () => join(ctx.paths.configRoot, "command");

  return {
    hera_create_command: tool({
      description:
        "Create a native OpenCode slash-command so typing /<name> invokes an agent. Writes <configRoot>/command/<name>.md routing to `agent`. This is how you ship keyword-triggered agents (e.g. /socrates) the way omo-style plugins do.",
      args: {
        name: z.string().describe("The /keyword — kebab-case, becomes /<name>"),
        agent: z.string().describe("Agent the command routes to (front-matter `agent:`)"),
        description: z.string().describe("One-line description shown in OpenCode's command list"),
        body: z
          .string()
          .optional()
          .describe(
            "Optional template body. Default: $ARGUMENTS (forwards the user's text to the agent)."
          ),
      },
      async execute(args) {
        const check = validateCommandName(args.name);
        if (!check.valid) return `Error: ${check.error}`;
        if (!args.agent || args.agent.trim().length === 0) {
          return "Error: agent is required (the command must route to an agent).";
        }
        const markdown = buildCommandMarkdown({
          name: args.name,
          agent: args.agent,
          description: args.description,
          body: args.body,
        });
        try {
          const path = await writeCommandFile(ctx.paths.configRoot, args.name, markdown);
          const knownAgent = args.agent === "hera" || ctx.registeredAgents.has(args.agent);
          const note = knownAgent
            ? ""
            : ` (note: "${args.agent}" is not a Hera-registered agent — ensure it exists in this OpenCode config, or it will resolve to nothing)`;
          return `Created /${args.name} -> @${args.agent} at ${path}. It now appears in OpenCode's / autocomplete.${note}`;
        } catch (err) {
          return `Error creating command: ${errorMessage(err)}`;
        }
      },
    }),

    hera_list_commands: tool({
      description: "List the native OpenCode slash-commands Hera manages (files under command/).",
      args: {},
      async execute() {
        try {
          const files = (await readdir(commandDir())).filter((f) => f.endsWith(".md"));
          if (files.length === 0) return "No command files found.";
          return files.map((f) => `/${f.replace(/\.md$/, "")}`).join("\n");
        } catch {
          return "No command files found.";
        }
      },
    }),

    hera_delete_command: tool({
      description: "Delete a native OpenCode slash-command file (command/<name>.md).",
      args: { name: z.string().describe("The /keyword to delete") },
      async execute(args) {
        const check = validateCommandName(args.name);
        if (!check.valid) return `Error: ${check.error}`;
        try {
          await unlink(join(commandDir(), `${args.name}.md`));
          return `Deleted /${args.name}.`;
        } catch {
          return `No command /${args.name} found.`;
        }
      },
    }),
  };
}
