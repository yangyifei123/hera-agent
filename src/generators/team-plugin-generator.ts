/**
 * TeamPluginGenerator - Generates an OpenCode plugin that registers a whole
 * team of agents as one package. Each member agent gets the standard prompt
 * (compact skill manifest + evolution log) augmented with team context so the
 * agent knows it's a member of the team and who else is on it. Skill bodies
 * ship once as skills/<name>/SKILL.md files, loaded on demand via a single
 * team-scoped `<team>_load_skill` tool shared by all members (spec §6).
 *
 * Shared infrastructure (tsconfig, writeToDisk, install/installWithBuild) is
 * delegated to PluginGenerator. The differing part — generatePluginIndex —
 * is implemented locally because the config hook registers N agents instead
 * of one.
 */

import type { TeamDefinition, AgentDefinition, SkillDefinition } from "../types.js";
import {
  PluginGenerator,
  generateCommandsFragment,
  toolSafeName,
  collectExportSkills,
  generateSkillLoaderFragment,
  type PluginPackage,
  type PluginFile,
  type CommandRunner,
  type BuildInstallResult,
} from "./plugin-generator.js";
import { buildAgentPrompt } from "../agents/hera.js";
import { heraLog } from "../logger.js";
import { TEAM_MANAGEMENT_DESCRIPTIONS } from "../constants.js";
import { createHash } from "node:crypto";

function camelCase(name: string): string {
  return name
    .split("-")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/**
 * Namespace fragment for the team's generated skill-loader tool (spec §6).
 *
 * Unlike agent names (validateAgentName enforces `^[a-z][a-z0-9-]*$` and
 * reserves "hera"), team names are NOT validated at creation, so the
 * derivation must be hardened:
 * - `toolSafeName()` returns "" for non-ASCII names (e.g. "团队") → fall back
 *   to a deterministic `team_<hash>` so two such plugins never collide on a
 *   bare `_load_skill` tool name;
 * - a digit-leading result (e.g. "3d-squad" → "3d_squad") would make the
 *   emitted object key a JS SyntaxError → prefix `team_`;
 * - "hera"/"Hera" would emit literally `hera_load_skill`, colliding with
 *   Hera's real loader tool when installed side by side → rename to
 *   `hera_team` (no real Hera tool is named `hera_team_load_skill`).
 */
function loaderNamespace(teamName: string): string {
  let ns = toolSafeName(teamName);
  if (!ns) {
    ns = `team_${createHash("sha256").update(teamName).digest("hex").slice(0, 8)}`;
  } else if (/^[0-9]/.test(ns)) {
    ns = `team_${ns}`;
  }
  if (ns === "hera") ns = "hera_team";
  return ns;
}

/**
 * Emitted `const <var>: Plugin` identifier. Hardened for the same reason as
 * loaderNamespace: strip non-identifier characters and guard digit-leading
 * results (`const 3dSquadTeamPlugin` is a SyntaxError).
 */
function pluginVarName(teamName: string): string {
  const raw = camelCase(teamPluginName(teamName)).replace(/[^0-9A-Za-z_$]/g, "");
  const safe = /^[0-9]/.test(raw) ? `_${raw}` : raw || "team";
  return `${safe}Plugin`;
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
  const management = team.management ?? "simple";
  const memberList = others.length
    ? others.map((m) => `- ${m.agentName} (role: ${m.role})`).join("\n")
    : "(you are the only member)";

  return [
    `## Team Context`,
    ``,
    `You are a member of the "${team.name}" team.`,
    `Coordination mode: ${team.coordination}.`,
    `Management style: ${management} — ${TEAM_MANAGEMENT_DESCRIPTIONS[management]}.`,
    ``,
    `Other members:`,
    memberList,
    ``,
    `Shared workspace (blackboard): Use \`hera_remember\` to publish decisions,`,
    `context, and results that all team members can see. Use \`hera_recall\` to`,
    `read what others have published before starting work to avoid duplicating effort.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Inline memory tool implementation block (shared with single-agent plugins).
 * The prologue (imports + helpers) is now built inline inside generatePluginIndex
 * so that the engine import can be conditionally inserted. Kept in sync
 * with PluginGenerator.generatePluginIndex.
 */

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

  /**
   * Generate package.json for the team plugin.
   *
   * @param withEngine - When true (default), adds `hera-agent` as a dependency so
   *   the generated plugin can import `createEngine` from `hera-agent/engine`.
   */
  generatePackageJson(team: TeamDefinition, withEngine = true) {
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
        ...(withEngine ? { "hera-agent": "^2.2.1" } : {}),
      },
      files: ["dist", "INSTALL.md", "skills"],
      license: "MIT",
    };
  }

  /**
   * Generate src/index.ts for the team plugin.
   *
   * @param withEngine - When true (default), the generated plugin bootstraps the
   *   HDTE engine via `createEngine` from `hera-agent/engine` and spreads
   *   `engine.tools` into the returned tool map.
   */
  generatePluginIndex(
    team: TeamDefinition,
    members: AgentDefinition[],
    resolvedSkills: SkillDefinition[],
    withEngine = true,
    withCommands = true
  ): string {
    const pluginVar = pluginVarName(team.name);

    // Progressive disclosure (spec §6): one team-scoped loader shared by all
    // members; skill bodies ship as skills/<name>/SKILL.md files.
    const exportSkills = collectExportSkills(resolvedSkills);
    const loaderToolName = `${loaderNamespace(team.name)}_load_skill`;

    // Native /keyword commands: one per member, so `/socrates …` invokes @socrates.
    const { helper: commandHelper, call: commandCall } = withCommands
      ? generateCommandsFragment(
          members.map((m) => ({ name: m.name, agent: m.name, description: m.description }))
        )
      : { helper: "", call: "" };

    const agentBlocks: string[] = [];
    for (const member of members) {
      const augmented: AgentDefinition = {
        ...member,
        prompt: `${member.prompt}\n\n${buildTeamContext(team, member.name)}`,
      };
      const fullPrompt = buildAgentPrompt(augmented, exportSkills, { loaderToolName });

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

    // Conditional engine import fragment (only when withEngine)
    const engineImport = withEngine ? `import { createEngine } from "hera-agent/engine";\n` : "";

    // Conditional getHeraDataDir helper (only when withEngine)
    const heraDataDirHelper = withEngine
      ? `
function getHeraDataDir(): string {
  const configRoot = process.env.HERA_CONFIG_ROOT || process.env.OPENCODE_CONFIG_ROOT;
  if (configRoot) return join(configRoot, "hera-data");
  const heraDir = process.env.HERA_DIR;
  if (heraDir) return heraDir;
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, ".config", "opencode", "hera-data");
}
`
      : "";

    // Conditional engine bootstrap (only when withEngine)
    const engineBootstrap = withEngine
      ? `  // llm_judge runs on the first member agent (not an isolated judge) — a documented limitation of exported team plugins.
  const engine = createEngine({ dataDir: getHeraDataDir(), cwd: getHeraDataDir(), client: input.client, singleton: true, judgeAgent: ${JSON.stringify(members[0]?.name ?? team.name)} });
  await engine.init();
  await engine.recover();
  engine.start();
`
      : "";

    // Conditional engine tools spread (only when withEngine)
    const engineToolsSpread = withEngine ? `      ...engine.tools,\n` : "";

    // Build the prologue with conditional engine import inserted
    const prologue = `import { tool } from "@opencode-ai/plugin";
import type { Plugin } from "@opencode-ai/plugin";
${engineImport}import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

const z = tool.schema;

// dist/index.js sits one level below the package root; skills/ sits at the root.
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  // Mirror Hera's config-root precedence so generated agents share Hera's memory
  // pool even under a custom config root:
  //   HERA_CONFIG_ROOT -> OPENCODE_CONFIG_ROOT -> HERA_DIR (compat) -> home default.
  const configRoot = process.env.HERA_CONFIG_ROOT || process.env.OPENCODE_CONFIG_ROOT;
  if (configRoot) return join(configRoot, "hera-data", "memory");
  const heraDir = process.env.HERA_DIR;
  if (heraDir) return join(heraDir, "memory");
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, ".config", "opencode", "hera-data", "memory");
}
${heraDataDirHelper}
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

    return `${prologue}${commandHelper}
const ${pluginVar}: Plugin = async (input) => {
${engineBootstrap}${commandCall}  return {
    async config(input) {
      // Register every team member agent
      input.agent = input.agent ?? {};
${agentBlocks.join("\n")}
    },
    tool: {
${engineToolsSpread}${generateSkillLoaderFragment(
      loaderToolName,
      exportSkills.map((s) => s.name)
    )}
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
    resolvedSkills: SkillDefinition[],
    opts: { withEngine?: boolean; withCommands?: boolean } = {}
  ): PluginPackage {
    heraLog("debug", `Generating team plugin package for: ${team.name}`);

    const withEngine = opts.withEngine ?? true;
    const withCommands = opts.withCommands ?? true;
    const files: PluginFile[] = [
      {
        path: "package.json",
        content: JSON.stringify(this.generatePackageJson(team, withEngine), null, 2) + "\n",
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify(this.inner.generateTsconfig(), null, 2) + "\n",
      },
      {
        path: "src/index.ts",
        content: this.generatePluginIndex(team, members, resolvedSkills, withEngine, withCommands),
      },
      {
        path: "INSTALL.md",
        content: this.generateInstallMd(team, `/path/to/${teamPluginName(team.name)}`),
      },
    ];

    // Progressive disclosure (spec §6): skill bodies ship as files, loaded on
    // demand by the generated `<team>_load_skill` tool shared by all members.
    const exportSkills = collectExportSkills(resolvedSkills);
    const skillFiles: PluginFile[] = exportSkills.map((s) => ({
      path: `skills/${s.name}/SKILL.md`,
      content: `# Skill: ${s.name}\n\n${s.description}\n\n${s.prompt}\n`,
    }));
    files.push(...skillFiles);

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
