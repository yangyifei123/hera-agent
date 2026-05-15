/**
 * PluginGenerator - Generates OpenCode plugin packages from AgentDefinition
 * 
 * Converts a Hera agent definition into a standalone OpenCode plugin
 * that can be installed via `bun add file://<path>`.
 */

import type { AgentDefinition, SkillPackage } from "../types.js";
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

/** Capabilities that influence plugin generation */
export interface AgentCapability {
  name: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

// === Template helpers ===

function generatePackageJson(agent: AgentDefinition): PluginFile {
  const pkg = {
    name: `hera-agent-${agent.name}`,
    version: "1.0.0",
    description: agent.description || `OpenCode plugin for agent: ${agent.name}`,
    type: "module",
    main: "./src/index.ts",
    exports: {
      ".": {
        import: "./src/index.ts",
      },
    },
  };
  return {
    path: "package.json",
    content: JSON.stringify(pkg, null, 2) + "\n",
  };
}

function generatePluginIndex(agent: AgentDefinition, skills: SkillPackage[]): PluginFile {
  const permission = agent.permission ?? { edit: "allow", bash: "allow", webfetch: "allow" };
  const maxSteps = agent.maxSteps ?? 30;

  const agentConfig = {
    description: agent.description,
    mode: agent.mode,
    prompt: agent.prompt,
    ...(agent.model ? { model: agent.model } : {}),
    temperature: 0.3,
    maxSteps,
    permission,
  };

  const indexContent = [
    `import type { Plugin } from "@opencode-ai/plugin";`,
    ``,
    `const AgentPlugin: Plugin = async (input) => {`,
    `  return {`,
    `    config: async (configInput) => {`,
    `      configInput.agent["${agent.name}"] = ${JSON.stringify(agentConfig, null, 8).split("\n").join("\n      ")};`,
    `    },`,
    `    tool: async () => {`,
    `      return {};`,
    `    },`,
    `  };`,
    `};`,
    ``,
    `export default AgentPlugin;`,
    ``,
  ].join("\n");

  return {
    path: "src/index.ts",
    content: indexContent,
  };
}

function generateAgentMd(agent: AgentDefinition): PluginFile {
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    `mode: ${agent.mode}`,
    "---",
    ``,
  ].join("\n");

  return {
    path: "agent.md",
    content: frontmatter + agent.prompt + "\n",
  };
}

function generateSkillFiles(skills: SkillPackage[]): PluginFile[] {
  return skills.map((skill) => ({
    path: `skills/${skill.name}.json`,
    content: JSON.stringify(skill, null, 2) + "\n",
  }));
}

function generateDefaultsJson(agent: AgentDefinition): PluginFile {
  const defaults = {
    agent: {
      name: agent.name,
      mode: agent.mode,
      model: agent.model ?? null,
      maxSteps: agent.maxSteps ?? 30,
    },
    skills: agent.skills,
  };
  return {
    path: "config/defaults.json",
    content: JSON.stringify(defaults, null, 2) + "\n",
  };
}

// === PluginGenerator class ===

export class PluginGenerator {
  /**
   * Generate a complete PluginPackage from an AgentDefinition.
   * The returned package contains all files needed for a standalone plugin.
   */
  generate(
    agentDef: AgentDefinition,
    capabilities: AgentCapability[],
    skills: SkillPackage[] = []
  ): PluginPackage {
    heraLog("debug", `Generating plugin package for agent: ${agentDef.name}`);

    const files: PluginFile[] = [];

    // Core files
    files.push(generatePackageJson(agentDef));
    files.push(generatePluginIndex(agentDef, skills));
    files.push(generateAgentMd(agentDef));

    // Skills
    if (skills.length > 0) {
      files.push(...generateSkillFiles(skills));
    }

    // Default config
    files.push(generateDefaultsJson(agentDef));

    // Capability files (placeholder for future expansion)
    const enabledCaps = capabilities.filter((c) => c.enabled);
    if (enabledCaps.length > 0) {
      const capContent = enabledCaps.map((c) => `- ${c.name}: enabled`).join("\n");
      files.push({
        path: "config/capabilities.md",
        content: `# Capabilities\n\n${capContent}\n`,
      });
    }

    const pkg: PluginPackage = {
      name: `hera-agent-${agentDef.name}`,
      version: "1.0.0",
      description: agentDef.description || `OpenCode plugin for agent: ${agentDef.name}`,
      main: "./src/index.ts",
      files,
    };

    heraLog("debug", `Generated ${files.length} files for plugin: ${pkg.name}`);
    return pkg;
  }

  /**
   * Write the plugin package to disk at the given directory.
   * Creates subdirectories as needed.
   */
  async writeToDisk(pkg: PluginPackage, outputDir: string): Promise<void> {
    heraLog("debug", `Writing plugin package to: ${outputDir}`);

    // Collect all directories needed
    const dirs = new Set<string>();
    for (const file of pkg.files) {
      const dir = join(outputDir, file.path, "..");
      dirs.add(dir);
    }

    // Create directories
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }

    // Write files
    for (const file of pkg.files) {
      const filePath = join(outputDir, file.path);
      await writeFile(filePath, file.content, "utf-8");
    }

    heraLog("debug", `Wrote ${pkg.files.length} files to ${outputDir}`);
  }

  /**
   * Install a plugin by adding it to opencode.json.
   * Reads {configRoot}/opencode.json, adds plugin entry, writes back.
   */
  async install(pluginPath: string, configRoot: string): Promise<void> {
    heraLog("debug", `Installing plugin from: ${pluginPath}`);

    const opencodeJsonPath = join(configRoot, "opencode.json");

    let opencodeConfig: Record<string, unknown>;
    try {
      const raw = await readFile(opencodeJsonPath, "utf-8");
      opencodeConfig = JSON.parse(raw);
    } catch {
      // opencode.json doesn't exist, create minimal config
      opencodeConfig = {};
    }

    // Ensure plugin array exists
    if (!Array.isArray(opencodeConfig.plugin)) {
      opencodeConfig.plugin = [];
    }

    const pluginArray = opencodeConfig.plugin as string[];

    // Normalize plugin path for the plugin array
    const pluginEntry = pluginPath.startsWith("file://")
      ? pluginPath
      : `file://${pluginPath}`;

    // Avoid duplicates
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
      // Nothing to uninstall
      heraLog("debug", "opencode.json not found, nothing to uninstall");
      return;
    }

    if (!Array.isArray(opencodeConfig.plugin)) {
      return;
    }

    const pluginArray = opencodeConfig.plugin as string[];
    const before = pluginArray.length;

    // Remove entries that match the plugin name or contain it
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
