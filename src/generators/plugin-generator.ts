/**
 * PluginGenerator - Generates OpenCode plugin packages from AgentDefinition
 *
 * Strategy: "Copy Hera's own skeleton" — the generated plugin uses the exact
 * same Plugin → config hook pattern that Hera itself uses (verified working).
 */

import type { AgentDefinition, SkillDefinition } from "../types.js";
import { buildAgentPrompt } from "../agents/hera.js";
import { BUILTIN_SKILLS } from "../skills/manager.js";
import { heraLog } from "../logger.js";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  sanitizeCommandDescription,
  sanitizeAgentRef,
  validateCommandName,
} from "../commands/command-file.js";

/**
 * Marker embedded in every command file a generated plugin writes. On reload the
 * plugin refreshes its own marked files but never clobbers a same-named command
 * authored by the user or another plugin (which will not carry this marker).
 */
export const GENERATED_COMMAND_MARKER = "<!-- generated-by: hera-plugin -->";

// === Types ===

export interface PluginFile {
  path: string;
  content: string;
}

export interface PluginPackage {
  name: string;
  version: string;
  description: string;
  main: string;
  files: PluginFile[];
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (cmd: string, args: string[], cwd: string) => Promise<CommandResult>;

export interface BuildInstallStep {
  name: "install" | "build" | "add";
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface BuildInstallResult {
  ok: boolean;
  steps: BuildInstallStep[];
}

export interface CommandFragmentSpec {
  /** The `/keyword` and command filename. */
  name: string;
  /** Agent the command routes to. */
  agent: string;
  /** One-line description for OpenCode's command list. */
  description: string;
}

/**
 * Build the inlined command-writing fragment for a generated plugin's
 * `src/index.ts`. On load the plugin writes `<configRoot>/command/<name>.md` for
 * each spec, so the bundled agents get native `/<name>` keyword commands in
 * OpenCode's autocomplete — the mechanism omo-style plugins use. Returns
 * `helper` (module-scope code) and `call` (an `await` inside the plugin body).
 *
 * Specs are hardened before embedding: names failing {@link validateCommandName}
 * are skipped, duplicates are dropped (last-writer collisions would be silent),
 * and `agent`/`description` are sanitized so neither can inject YAML front-matter
 * into the generated file. Each written file carries {@link GENERATED_COMMAND_MARKER}
 * so a reload refreshes the plugin's own commands without clobbering a same-named
 * command the user or another plugin authored.
 *
 * Runtime writes are best-effort: agent injection still works if they fail. The
 * command dir honors `HERA_CONFIG_ROOT`/`OPENCODE_CONFIG_ROOT`, so a sandboxed
 * root keeps a generated plugin from touching a live install. Returns empty
 * strings when no spec is safe/present (no command support requested).
 */
export function generateCommandsFragment(specs: CommandFragmentSpec[]): {
  helper: string;
  call: string;
} {
  const seen = new Set<string>();
  const safe: CommandFragmentSpec[] = [];
  for (const s of specs) {
    if (!validateCommandName(s.name).valid) continue; // skip unsafe/invalid names
    if (seen.has(s.name)) continue; // drop silent duplicate-command collisions
    seen.add(s.name);
    safe.push({
      name: s.name,
      agent: sanitizeAgentRef(s.agent),
      description: sanitizeCommandDescription(s.description),
    });
  }
  if (safe.length === 0) return { helper: "", call: "" };
  const arrayLiteral = JSON.stringify(safe, null, 2);
  const helper = `
const GENERATED_COMMAND_MARKER = ${JSON.stringify(GENERATED_COMMAND_MARKER)};

function getCommandDir(): string {
  const configRoot = process.env.HERA_CONFIG_ROOT || process.env.OPENCODE_CONFIG_ROOT;
  if (configRoot) return join(configRoot, "command");
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return join(home, ".config", "opencode", "command");
}

const PLUGIN_COMMANDS: Array<{ name: string; agent: string; description: string }> = ${arrayLiteral};

async function writePluginCommands(): Promise<void> {
  try {
    const dir = getCommandDir();
    await mkdir(dir, { recursive: true });
    for (const c of PLUGIN_COMMANDS) {
      const file = join(dir, c.name + ".md");
      try {
        // Don't overwrite a same-named command we didn't generate.
        const existing = await readFile(file, "utf-8");
        if (!existing.includes(GENERATED_COMMAND_MARKER)) continue;
      } catch {
        // File absent → safe to create.
      }
      const md = "---\\ndescription: " + c.description + "\\nagent: " + c.agent + "\\n---\\n\\n" + GENERATED_COMMAND_MARKER + "\\n$ARGUMENTS\\n";
      await writeFile(file, md, "utf-8");
    }
  } catch {
    // best-effort: commands are a convenience; agent injection still works
  }
}
`;
  return { helper, call: `  await writePluginCommands();\n` };
}

/**
 * Default command runner — uses Bun.spawn (Bun runtime guaranteed).
 */
const defaultRunner: CommandRunner = async (cmd, args, cwd) => {
  // Bun.spawn is available at runtime; guard for non-Bun envs in tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BunGlobal = (globalThis as any).Bun;
  if (!BunGlobal?.spawn) {
    return { ok: false, stdout: "", stderr: "Bun.spawn not available" };
  }
  const proc = BunGlobal.spawn([cmd, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr };
};

// === Helper ===

function camelCase(name: string): string {
  return name
    .split("-")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** Plugin-scoped identifier fragment for generated tool names. */
export function toolSafeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

// === PluginGenerator class ===

export class PluginGenerator {
  private runner: CommandRunner;

  constructor(runner: CommandRunner = defaultRunner) {
    this.runner = runner;
  }

  /**
   * Generate package.json — mirrors Hera's own package.json
   *
   * @param withEngine - When true (default), adds `hera-agent` as a dependency so
   *   the generated plugin can import `createEngine` from `hera-agent/engine`.
   */
  generatePackageJson(
    agent: AgentDefinition,
    withEngine = true
  ): {
    name: string;
    version: string;
    description: string;
    type: string;
    main: string;
    types: string;
    exports: {
      ".": {
        types: string;
        import: string;
        default: string;
      };
    };
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    files: string[];
    license: string;
  } {
    return {
      name: agent.name,
      version: "1.0.0",
      description: agent.description || `OpenCode agent plugin: ${agent.name}`,
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
        build: `bun build src/index.ts --outdir dist --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk && echo 'build done'`,
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
   * Generate src/index.ts — uses the exact same Plugin → config hook pattern as Hera.
   *
   * The prompt baked into the generated plugin is assembled via `buildAgentPrompt`,
   * which renders a compact skill manifest (built-ins plus any additional
   * `resolvedSkills`) and the non-rolledBack evolution log directives — giving
   * the generated agent prompt parity with the .md mode (progressive
   * disclosure, spec §5/§6). Skill bodies ship as `skills/<name>/SKILL.md`
   * files loaded on demand via a plugin-namespaced `<plugin>_load_skill` tool.
   *
   * Also inlines `hera_remember` and `hera_recall` tool implementations so the
   * agent's memory skill is actually functional. The tools read/write the same
   * `<configRoot>/hera-data/memory/` directory Hera itself uses, so generated
   * agents share a memory pool with Hera and with each other.
   *
   * @param withEngine - When true (default), the generated plugin bootstraps the
   *   HDTE engine via `createEngine` from `hera-agent/engine` and spreads
   *   `engine.tools` into the returned tool map.
   */
  generatePluginIndex(
    agent: AgentDefinition,
    resolvedSkills: SkillDefinition[] = [],
    withEngine = true,
    withCommands = true
  ): string {
    const exportSkills = collectExportSkills(resolvedSkills);
    const loaderToolName = `${toolSafeName(agent.name)}_load_skill`;
    const fullPrompt = buildAgentPrompt(agent, exportSkills, { loaderToolName });

    // Conditional native `/<agent>` command fragment. On load the plugin writes
    // command/<agent>.md so the bundled agent gets a keyword command in
    // OpenCode's autocomplete (the mechanism omo-style plugins use).
    const { helper: commandHelper, call: commandCall } = withCommands
      ? generateCommandsFragment([
          { name: agent.name, agent: agent.name, description: agent.description },
        ])
      : { helper: "", call: "" };

    const agentConfig = {
      description: agent.description,
      mode: agent.mode,
      prompt: fullPrompt,
      ...(agent.model ? { model: agent.model } : {}),
      temperature: 0.3,
      maxSteps: agent.maxSteps ?? 30,
      permission: {
        edit: "allow" as const,
        bash: "allow" as const,
        webfetch: "allow" as const,
      },
    };

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
      ? `  const engine = createEngine({ dataDir: getHeraDataDir(), cwd: getHeraDataDir(), client: input.client, singleton: true, judgeAgent: ${JSON.stringify(agent.name)} });
  await engine.init();
  await engine.recover();
  engine.start();
`
      : "";

    // Conditional engine tools spread (only when withEngine)
    const engineToolsSpread = withEngine ? `      ...engine.tools,\n` : "";

    const code = `import { tool } from "@opencode-ai/plugin";
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
${commandHelper}
const ${camelCase(agent.name)}Plugin: Plugin = async (input) => {
${engineBootstrap}${commandCall}  return {
    async config(input) {
      // Register agent — same pattern as Hera's own config hook
      input.agent = input.agent ?? {};
      input.agent["${agent.name}"] = ${JSON.stringify(agentConfig, null, 6).split("\n").join("\n      ")};
    },
    tool: {
${engineToolsSpread}${generateSkillLoaderFragment(
      loaderToolName,
      exportSkills.map((s) => s.name)
    )}
      hera_remember: tool({
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
      }),
    },
  };
};

export default ${camelCase(agent.name)}Plugin;
`;

    return code;
  }

  /**
   * Generate INSTALL.md — installation instructions for the generated plugin
   */
  generateInstallMd(agent: AgentDefinition, pluginDir: string): string {
    const pluginName = agent.name;
    const normalizedPath = pluginDir.replace(/\\/g, "/");

    return `# Installing ${pluginName}

This is a generated OpenCode agent plugin. Follow these steps to install it.

## Step 1: Build the plugin

\`\`\`bash
cd ${normalizedPath}
bun install
bun run build
\`\`\`

## Step 2: Install into OpenCode

\`\`\`bash
cd ~/.config/opencode
bun add file://${normalizedPath}
\`\`\`

## Step 3: Add to opencode.json

Make sure your \`~/.config/opencode/opencode.json\` includes:

\`\`\`json
{
  "plugin": ["${pluginName}"]
}
\`\`\`

## Step 4: Verify

\`\`\`bash
opencode --agent ${pluginName} "Hello, are you working?"
\`\`\`

## Troubleshooting

- If OpenCode doesn't find the plugin, run \`bun install\` in \`~/.config/opencode/\`
- If the agent doesn't appear, check that \`"plugin"\` array in \`opencode.json\` includes \`"${pluginName}"\`
- To uninstall: remove from \`opencode.json\` plugin array, then \`bun remove ${pluginName}\` in \`~/.config/opencode/\`
`;
  }

  /**
   * Generate tsconfig.json so the generated plugin can be built standalone.
   */
  generateTsconfig(): Record<string, unknown> {
    return {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022"],
        types: ["bun-types"],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        declaration: true,
        outDir: "./dist",
        rootDir: "./src",
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"],
    };
  }

  /**
   * Generate a complete PluginPackage from an AgentDefinition.
   *
   * Pass `resolvedSkills` so additional user skills (beyond the built-ins) are
   * listed in the baked manifest and shipped as `skills/<name>/SKILL.md` files
   * for the generated loader tool to read on demand.
   */
  generate(
    agentDef: AgentDefinition,
    resolvedSkills: SkillDefinition[] = [],
    opts: { withEngine?: boolean; withCommands?: boolean } = {}
  ): PluginPackage {
    heraLog("debug", `Generating plugin package for agent: ${agentDef.name}`);

    const withEngine = opts.withEngine ?? true;
    const withCommands = opts.withCommands ?? true;
    const files: PluginFile[] = [];

    const pkgJson = this.generatePackageJson(agentDef, withEngine);
    files.push({
      path: "package.json",
      content: JSON.stringify(pkgJson, null, 2) + "\n",
    });

    files.push({
      path: "tsconfig.json",
      content: JSON.stringify(this.generateTsconfig(), null, 2) + "\n",
    });

    files.push({
      path: "src/index.ts",
      content: this.generatePluginIndex(agentDef, resolvedSkills, withEngine, withCommands),
    });

    files.push({
      path: "INSTALL.md",
      content: this.generateInstallMd(agentDef, `/path/to/${agentDef.name}`),
    });

    // Progressive disclosure (spec §6): skill bodies ship as files, loaded on
    // demand by the generated `<plugin>_load_skill` tool.
    const exportSkills = collectExportSkills(resolvedSkills);
    const skillFiles: PluginFile[] = exportSkills.map((s) => ({
      path: `skills/${s.name}/SKILL.md`,
      content: `# Skill: ${s.name}\n\n${s.description}\n\n${s.prompt}\n`,
    }));
    files.push(...skillFiles);

    const pkg: PluginPackage = {
      name: agentDef.name,
      version: "1.0.0",
      description: agentDef.description || `OpenCode agent plugin: ${agentDef.name}`,
      main: "./dist/index.js",
      files,
    };

    heraLog("debug", `Generated ${files.length} files for plugin: ${pkg.name}`);
    return pkg;
  }

  /**
   * Write the plugin package to disk at the given directory.
   */
  async writeToDisk(pkg: PluginPackage, outputDir: string): Promise<void> {
    heraLog("debug", `Writing plugin package to: ${outputDir}`);

    const dirs = new Set<string>();
    for (const file of pkg.files) {
      const dir = join(outputDir, file.path, "..");
      dirs.add(dir);
    }

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    for (const file of pkg.files) {
      const filePath = join(outputDir, file.path);
      await writeFile(filePath, file.content, "utf-8");
    }

    heraLog("debug", `Wrote ${pkg.files.length} files to ${outputDir}`);
  }

  /**
   * Install a plugin by adding it to opencode.json.
   */
  async install(pluginPath: string, configRoot: string): Promise<void> {
    heraLog("debug", `Installing plugin from: ${pluginPath}`);

    // Ensure configRoot exists — covers first-install scenarios where the
    // OpenCode config dir hasn't been created yet.
    await mkdir(configRoot, { recursive: true });

    const opencodeJsonPath = join(configRoot, "opencode.json");

    let opencodeConfig: Record<string, unknown>;
    try {
      const raw = await readFile(opencodeJsonPath, "utf-8");
      opencodeConfig = JSON.parse(raw);
    } catch {
      opencodeConfig = {};
    }

    if (!Array.isArray(opencodeConfig.plugin)) {
      opencodeConfig.plugin = [];
    }

    const pluginArray = opencodeConfig.plugin as string[];
    const pluginEntry = pluginPath.startsWith("file://") ? pluginPath : `file://${pluginPath}`;

    if (!pluginArray.includes(pluginEntry)) {
      pluginArray.push(pluginEntry);
    }

    await writeFile(opencodeJsonPath, JSON.stringify(opencodeConfig, null, 2) + "\n", "utf-8");

    heraLog("debug", `Plugin added to ${opencodeJsonPath}`);
  }

  /**
   * Build the plugin (bun install + bun run build) and register it
   * (bun add file://, then opencode.json edit). Each step's stdout/stderr
   * is captured so failures can be surfaced to the user.
   *
   * Stops at the first failure to avoid producing a broken half-install.
   */
  async installWithBuild(pluginDir: string, configRoot: string): Promise<BuildInstallResult> {
    const steps: BuildInstallStep[] = [];

    const installRes = await this.runner("bun", ["install"], pluginDir);
    steps.push({ name: "install", ...installRes });
    if (!installRes.ok) return { ok: false, steps };

    const buildRes = await this.runner("bun", ["run", "build"], pluginDir);
    steps.push({ name: "build", ...buildRes });
    if (!buildRes.ok) return { ok: false, steps };

    const addRes = await this.runner("bun", ["add", `file://${pluginDir}`], configRoot);
    steps.push({ name: "add", ...addRes });
    if (!addRes.ok) return { ok: false, steps };

    // Final step: ensure opencode.json includes the plugin entry.
    await this.install(pluginDir, configRoot);

    return { ok: true, steps };
  }

  /**
   * Uninstall a plugin by removing it from opencode.json.
   */
  async uninstall(pluginName: string, configRoot: string): Promise<void> {
    heraLog("debug", `Uninstalling plugin: ${pluginName}`);

    const opencodeJsonPath = join(configRoot, "opencode.json");

    let opencodeConfig: Record<string, unknown>;
    try {
      const raw = await readFile(opencodeJsonPath, "utf-8");
      opencodeConfig = JSON.parse(raw);
    } catch {
      heraLog("debug", "opencode.json not found, nothing to uninstall");
      return;
    }

    if (!Array.isArray(opencodeConfig.plugin)) {
      return;
    }

    const pluginArray = opencodeConfig.plugin as string[];
    const before = pluginArray.length;

    opencodeConfig.plugin = pluginArray.filter(
      (entry) => typeof entry === "string" && !entry.includes(pluginName)
    );

    const removed = before - (opencodeConfig.plugin as string[]).length;
    if (removed > 0) {
      await writeFile(opencodeJsonPath, JSON.stringify(opencodeConfig, null, 2) + "\n", "utf-8");
      heraLog("debug", `Removed ${removed} plugin entries from opencode.json`);
    } else {
      heraLog("debug", `No matching plugin entries found for: ${pluginName}`);
    }
  }
}
