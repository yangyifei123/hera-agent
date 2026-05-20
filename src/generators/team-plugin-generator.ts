/**
 * TeamPluginGenerator - Generates an OpenCode plugin that registers a whole
 * team of agents as one package. Each member agent gets the standard prompt
 * (built-in skills + evolution log) augmented with team context so the agent
 * knows it's a member of the team and who else is on it.
 *
 * Shared infrastructure (tsconfig, writeToDisk, install/installWithBuild) is
 * delegated to PluginGenerator. The differing part — generatePluginIndex —
 * is implemented locally because the config hook registers N agents instead
 * of one.
 */

import type { TeamDefinition, AgentDefinition, SkillDefinition } from "../types.js";
import {
  PluginGenerator,
  type PluginPackage,
  type PluginFile,
  type CommandRunner,
  type BuildInstallResult,
} from "./plugin-generator.js";
import { buildAgentPrompt } from "../agents/hera.js";
import { heraLog } from "../logger.js";

function camelCase(name: string): string {
  return name
    .split("-")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** Plugin name suffix to distinguish team plugins from single-agent ones. */
function teamPluginName(teamName: string): string {
  return `${teamName}-team`;
}

/**
 * Build the team-context block prepended to a member's prompt so the agent
 * knows it's part of the team and who the other members are.
 */
function buildTeamContext(team: TeamDefinition, selfName: string): string {
  const others = team.members.filter((m) => m.agentName !== selfName);
  const memberList = others.length
    ? others.map((m) => `- ${m.agentName} (role: ${m.role})`).join("\n")
    : "(you are the only member)";

  return [
    `## Team Context`,
    ``,
    `You are a member of the "${team.name}" team.`,
    `Coordination mode: ${team.coordination}.`,
    team.management ? `Management style: ${team.management}.` : "",
    ``,
    `Other members:`,
    memberList,
    ``,
    `Coordinate via shared memory: \`hera_remember\` writes are visible to all`,
    `members. Use \`hera_recall\` to consult team-shared context before starting`,
    `work to avoid duplicating effort.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Inline memory tool code (shared with single-agent plugins). Kept in sync
 * with PluginGenerator.generatePluginIndex.
 */
const MEMORY_TOOL_PROLOGUE = `import { tool } from "@opencode-ai/plugin";
import type { Plugin } from "@opencode-ai/plugin";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

const z = tool.schema;

// Memory category → on-disk subdirectory (mirrors Hera's store layout)
const SUBDIR: Record<string, string> = {
  session: "sessions",
  skill: "skills",
  agent: "agents",
  team: "teams",
  distillation: "distillations",
  decision: "decisions",
  fix: "fixes",
  pattern: "patterns",
  preference: "preferences",
  context: "contexts",
};

function getMemoryDir(): string {
  const env = process.env.HERA_DIR;
  if (env) return join(env, "memory");
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, ".config", "opencode", "hera-data", "memory");
}

async function saveMemory(content: string, category: string): Promise<string> {
  const sub = SUBDIR[category] ?? category + "s";
  const dir = join(getMemoryDir(), sub);
  await mkdir(dir, { recursive: true });
  const id = "memo-" + randomUUID().slice(0, 8);
  const memo = { id, type: category, content, timestamp: Date.now() };
  await writeFile(join(dir, id + ".json"), JSON.stringify(memo, null, 2), "utf-8");
  return id;
}

async function searchMemory(
  query: string,
  category: string | undefined,
  limit: number,
  since: number | undefined
): Promise<Array<{ id: string; type: string; content: string; timestamp: number }>> {
  const root = getMemoryDir();
  const subs = category ? [SUBDIR[category] ?? category + "s"] : Object.values(SUBDIR);
  const results: Array<{ id: string; type: string; content: string; timestamp: number }> = [];
  for (const sub of subs) {
    const dir = join(root, sub);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        const memo = JSON.parse(raw);
        if (since != null && memo.timestamp < since) continue;
        const q = query.toLowerCase();
        if (
          memo.content?.toLowerCase().includes(q) ||
          memo.id?.toLowerCase().includes(q)
        ) {
          results.push(memo);
        }
      } catch {
        // Skip malformed file
      }
    }
  }
  return results
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
`;

const MEMORY_TOOL_BLOCK = `      hera_remember: tool({
        description: "Store information in Hera's persistent memory (shared with Hera and other generated agents).",
        args: {
          content: z.string().describe("Information to remember"),
          category: z.enum([
            "session", "skill", "agent", "team", "distillation",
            "preference", "decision", "pattern", "fix", "context",
          ]).describe("Memory category"),
        },
        async execute(args) {
          const id = await saveMemory(args.content, args.category);
          return "Remembered as " + id + " in " + args.category + " memory.";
        },
      }),
      hera_recall: tool({
        description: "Search Hera's persistent memory.",
        args: {
          query: z.string().describe("Search query (substring match)"),
          category: z.enum([
            "session", "skill", "agent", "team", "distillation",
            "preference", "decision", "pattern", "fix", "context",
          ]).optional().describe("Filter by category"),
          limit: z.number().optional().describe("Max results (default 10, max 50)"),
          since: z.number().optional().describe("Only memories from this Unix timestamp onward"),
        },
        async execute(args) {
          const effectiveLimit = args.limit != null ? Math.min(args.limit, 50) : 10;
          const results = await searchMemory(args.query, args.category, effectiveLimit, args.since);
          if (results.length === 0) return "No matching memories found.";
          return results.map((m) => "[" + m.type + "] " + m.content.slice(0, 200)).join("\\n---\\n");
        },
      }),`;

export class TeamPluginGenerator {
  private inner: PluginGenerator;

  constructor(runner?: CommandRunner) {
    this.inner = new PluginGenerator(runner);
  }

  generatePackageJson(team: TeamDefinition) {
    return {
      name: teamPluginName(team.name),
      version: "1.0.0",
      description: team.description || `OpenCode team plugin: ${team.name}`,
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
      scripts: {
        build:
          "bun build src/index.ts --outdir dist --target bun --format esm " +
          "--external @opencode-ai/plugin --external @opencode-ai/sdk && echo 'build done'",
      },
      dependencies: {
        "@opencode-ai/plugin": "^1.4.6",
      },
      files: ["dist", "INSTALL.md"],
      license: "MIT",
    };
  }

  generatePluginIndex(
    team: TeamDefinition,
    members: AgentDefinition[],
    resolvedSkills: SkillDefinition[]
  ): string {
    const pluginVar = camelCase(teamPluginName(team.name)) + "Plugin";

    const agentBlocks: string[] = [];
    for (const member of members) {
      const augmented: AgentDefinition = {
        ...member,
        prompt: `${member.prompt}\n\n${buildTeamContext(team, member.name)}`,
      };
      const fullPrompt = buildAgentPrompt(augmented, resolvedSkills);

      const agentConfig = {
        description: augmented.description,
        mode: augmented.mode,
        prompt: fullPrompt,
        ...(augmented.model ? { model: augmented.model } : {}),
        temperature: 0.3,
        maxSteps: augmented.maxSteps ?? 30,
        permission: {
          edit: "allow" as const,
          bash: "allow" as const,
          webfetch: "allow" as const,
        },
      };

      const configJson = JSON.stringify(agentConfig, null, 6).split("\n").join("\n      ");

      agentBlocks.push(`      input.agent["${member.name}"] = ${configJson};`);
    }

    return `${MEMORY_TOOL_PROLOGUE}
const ${pluginVar}: Plugin = async (input) => {
  return {
    async config(input) {
      // Register every team member agent
      input.agent = input.agent ?? {};
${agentBlocks.join("\n")}
    },
    tool: {
${MEMORY_TOOL_BLOCK}
    },
  };
};

export default ${pluginVar};
`;
  }

  generateInstallMd(team: TeamDefinition, pluginDir: string): string {
    const name = teamPluginName(team.name);
    const normalized = pluginDir.replace(/\\/g, "/");
    const memberList = team.members.map((m) => `- @${m.agentName} — ${m.role}`).join("\n");

    return `# Installing ${name}

This plugin registers the **${team.name}** team (${team.members.length} agents) as an OpenCode plugin.

## Team members

${memberList}

Coordination: \`${team.coordination}\`${team.management ? ` · Management: \`${team.management}\`` : ""}.

## Step 1: Build the plugin

\`\`\`bash
cd ${normalized}
bun install
bun run build
\`\`\`

## Step 2: Install into OpenCode

\`\`\`bash
cd ~/.config/opencode
bun add file://${normalized}
\`\`\`

## Step 3: Verify

Each team member is available as an agent:

\`\`\`bash
${team.members.map((m) => `opencode --agent ${m.agentName} "your task"`).join("\n")}
\`\`\`

## Troubleshooting

- Members coordinate via shared memory (\`~/.config/opencode/hera-data/memory/\`). The team-level orchestration (parallel/sequential/adaptive) requires running them under Hera. This plugin gives you the agent shapes; orchestration is a Hera concern.
- To uninstall: \`bun remove ${name}\` in \`~/.config/opencode/\`.
`;
  }

  generate(
    team: TeamDefinition,
    members: AgentDefinition[],
    resolvedSkills: SkillDefinition[]
  ): PluginPackage {
    heraLog("debug", `Generating team plugin package for: ${team.name}`);

    const files: PluginFile[] = [
      {
        path: "package.json",
        content: JSON.stringify(this.generatePackageJson(team), null, 2) + "\n",
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(this.inner.generateTsconfig(), null, 2) + "\n",
      },
      {
        path: "src/index.ts",
        content: this.generatePluginIndex(team, members, resolvedSkills),
      },
      {
        path: "INSTALL.md",
        content: this.generateInstallMd(team, `/path/to/${teamPluginName(team.name)}`),
      },
    ];

    return {
      name: teamPluginName(team.name),
      version: "1.0.0",
      description: team.description || `OpenCode team plugin: ${team.name}`,
      main: "./dist/index.js",
      files,
    };
  }

  async writeToDisk(pkg: PluginPackage, outputDir: string): Promise<void> {
    return this.inner.writeToDisk(pkg, outputDir);
  }

  async install(pluginPath: string, configRoot: string): Promise<void> {
    return this.inner.install(pluginPath, configRoot);
  }

  async uninstall(name: string, configRoot: string): Promise<void> {
    return this.inner.uninstall(name, configRoot);
  }

  async installWithBuild(pluginDir: string, configRoot: string): Promise<BuildInstallResult> {
    return this.inner.installWithBuild(pluginDir, configRoot);
  }
}
