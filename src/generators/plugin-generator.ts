/**
 * PluginGenerator - Generates OpenCode plugin packages from AgentDefinition
 *
 * Strategy: "Copy Hera's own skeleton" — the generated plugin uses the exact
 * same Plugin → config hook pattern that Hera itself uses (verified working).
 */

import type { AgentDefinition } from "../types.js";
import { heraLog } from "../logger.js";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

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

// === Helper ===

function camelCase(name: string): string {
  return name
    .split("-")
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// === PluginGenerator class ===

export class PluginGenerator {

  /**
   * Generate package.json — mirrors Hera's own package.json
   */
  generatePackageJson(agent: AgentDefinition): {
    name: string;
    version: string;
    description: string;
    type: string;
    main: string;
    types: string;
    exports: Record<string, any>;
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
      },
      files: ["dist", "INSTALL.md"],
      license: "MIT",
    };
  }

  /**
   * Generate src/index.ts — uses the exact same Plugin → config hook pattern as Hera
   */
  generatePluginIndex(agent: AgentDefinition): string {
    const agentConfig = {
      description: agent.description,
      mode: agent.mode,
      prompt: agent.prompt,
      ...(agent.model ? { model: agent.model } : {}),
      temperature: 0.3,
      maxSteps: agent.maxSteps ?? 30,
      permission: {
        edit: "allow" as const,
        bash: "allow" as const,
        webfetch: "allow" as const,
      },
    };

    const code = `import type { Plugin } from "@opencode-ai/plugin";

const ${camelCase(agent.name)}Plugin: Plugin = async (input) => {
  return {
    async config(input) {
      // Register agent — same pattern as Hera's own config hook
      input.agent = input.agent ?? {};
      input.agent["${agent.name}"] = ${JSON.stringify(agentConfig, null, 6).split("\n").join("\n      ")};
    },
    tool: {},
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
   * Generate a complete PluginPackage from an AgentDefinition.
   */
  generate(agentDef: AgentDefinition): PluginPackage {
    heraLog("debug", `Generating plugin package for agent: ${agentDef.name}`);

    const files: PluginFile[] = [];

    const pkgJson = this.generatePackageJson(agentDef);
    files.push({
      path: "package.json",
      content: JSON.stringify(pkgJson, null, 2) + "\n",
    });

    files.push({
      path: "src/index.ts",
      content: this.generatePluginIndex(agentDef),
    });

    files.push({
      path: "INSTALL.md",
      content: this.generateInstallMd(agentDef, `/path/to/${agentDef.name}`),
    });

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
    const pluginEntry = pluginPath.startsWith("file://")
      ? pluginPath
      : `file://${pluginPath}`;

    if (!pluginArray.includes(pluginEntry)) {
      pluginArray.push(pluginEntry);
    }

    await writeFile(
      opencodeJsonPath,
      JSON.stringify(opencodeConfig, null, 2) + "\n",
      "utf-8"
    );

    heraLog("debug", `Plugin added to ${opencodeJsonPath}`);
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
      (entry) =>
        typeof entry === "string" &&
        !entry.includes(pluginName)
    );

    const removed = before - (opencodeConfig.plugin as string[]).length;
    if (removed > 0) {
      await writeFile(
        opencodeJsonPath,
        JSON.stringify(opencodeConfig, null, 2) + "\n",
        "utf-8"
      );
      heraLog("debug", `Removed ${removed} plugin entries from opencode.json`);
    } else {
      heraLog("debug", `No matching plugin entries found for: ${pluginName}`);
    }
  }
}
