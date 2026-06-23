import { tool } from "@opencode-ai/plugin";
import type { PluginContext } from "../types.js";
import { heraLog } from "../logger.js";
import { join, resolve, sep } from "node:path";
import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { validateAgentName } from "../validation.js";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { pack, extract } from "tar-fs";
import { getConfigRoot } from "../constants.js";

const z = tool.schema;

interface PackageManifest {
  version: "1.0";
  agentName: string;
  packagedAt: number;
  mode: "md" | "plugin";
  includesMemory: boolean;
  files: string[];
}

/** The only package manifest version this build understands. */
export const SUPPORTED_PACKAGE_VERSION = "1.0";

/**
 * Returns true only if `entryName` resolves to a path inside `rootDir`.
 * Blocks archive entries that try to escape the extraction root via `..`
 * segments or absolute paths (Zip-Slip / tar traversal).
 */
export function isEntryInsideDir(rootDir: string, entryName: string): boolean {
  const root = resolve(rootDir);
  const target = resolve(root, entryName);
  return target === root || target.startsWith(root + sep);
}

/**
 * Validate a parsed package manifest before any install/write side effect.
 * Rejects unsupported versions, missing/invalid agent names (which feed into
 * destination paths), and unknown modes.
 */
export function validateManifest(
  manifest: unknown
): { valid: true; manifest: PackageManifest } | { valid: false; error: string } {
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, error: "Package manifest is missing or not an object." };
  }
  const m = manifest as Record<string, unknown>;

  if (m.version !== SUPPORTED_PACKAGE_VERSION) {
    return {
      valid: false,
      error: `Unsupported package version "${String(m.version)}". This build supports version ${SUPPORTED_PACKAGE_VERSION}.`,
    };
  }

  if (typeof m.agentName !== "string" || m.agentName.length === 0) {
    return { valid: false, error: "Package manifest is missing a valid agentName." };
  }
  const nameCheck = validateAgentName(m.agentName);
  if (!nameCheck.valid) {
    return { valid: false, error: `Invalid agent name in manifest: ${nameCheck.error}` };
  }

  if (m.mode !== "md" && m.mode !== "plugin") {
    return { valid: false, error: `Invalid package mode "${String(m.mode)}". Expected "md" or "plugin".` };
  }

  return { valid: true, manifest: m as unknown as PackageManifest };
}

/**
 * Get the package output directory
 */
function getPackageDir(): string {
  const configRoot = getConfigRoot();
  return join(configRoot, "hera-data", "packages");
}

/**
 * Get agent plugin directory if it exists
 */
async function getAgentPluginDir(agentName: string): Promise<string | null> {
  const configRoot = getConfigRoot();
  const pluginDir = join(configRoot, "node_modules", agentName);

  try {
    await stat(pluginDir);
    return pluginDir;
  } catch {
    return null;
  }
}

/**
 * Get agent .md file path if it exists
 */
async function getAgentMdPath(agentName: string): Promise<string | null> {
  const configRoot = getConfigRoot();
  const mdPath = join(configRoot, "agents", "hera", `${agentName}.md`);

  try {
    await stat(mdPath);
    return mdPath;
  } catch {
    return null;
  }
}

/**
 * Get agent memory files
 */
async function getAgentMemoryFiles(agentName: string): Promise<string[]> {
  const configRoot = getConfigRoot();
  const memoryDir = join(configRoot, "hera-data", "memory");
  const files: string[] = [];

  try {
    const categories = await readdir(memoryDir);
    for (const category of categories) {
      const categoryPath = join(memoryDir, category);
      const categoryStat = await stat(categoryPath);
      if (!categoryStat.isDirectory()) continue;

      const memFiles = await readdir(categoryPath);
      for (const file of memFiles) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(categoryPath, file);
        const content = await readFile(filePath, "utf-8");

        // Check if memory mentions this agent
        if (content.toLowerCase().includes(agentName.toLowerCase())) {
          files.push(join(category, file));
        }
      }
    }
  } catch (err) {
    heraLog("warn", `Could not scan memory files: ${err}`);
  }

  return files;
}

/**
 * Create a tar.gz package
 */
async function createTarGz(sourceDir: string, outputPath: string, files?: string[]): Promise<void> {
  const gzip = createGzip();
  const output = createWriteStream(outputPath);

  const packStream = files ? pack(sourceDir, { entries: files }) : pack(sourceDir);

  await pipeline(packStream, gzip, output);
}

/**
 * Extract a tar.gz package
 */
async function extractTarGz(
  archivePath: string,
  targetDir: string
): Promise<{ unsafeEntries: string[] }> {
  const unsafeEntries: string[] = [];
  const gunzip = createGunzip();
  const input = createReadStream(archivePath);
  const extractStream = extract(targetDir, {
    // Skip (never write) any entry that would escape the extraction root, and
    // record it so the caller can reject the whole package.
    ignore(name) {
      if (!isEntryInsideDir(targetDir, name)) {
        unsafeEntries.push(name);
        return true;
      }
      return false;
    },
  });

  await pipeline(input, gunzip, extractStream);
  return { unsafeEntries };
}

export function createPackageTools(_ctx: PluginContext) {
  return {
    hera_package_agent: tool({
      description:
        "Package an agent for migration/distribution. Creates a .tar.gz file containing the agent's plugin code (if plugin mode), .md file (if md mode), and optionally related memory data.",
      args: {
        name: z.string().describe("Agent name to package"),
        includeMemory: z
          .boolean()
          .optional()
          .describe("Include related memory data (default: false)"),
        outputName: z
          .string()
          .optional()
          .describe("Custom output filename (without extension, default: <agent-name>-package)"),
      },
      async execute(args) {
        const agentName = args.name;
        const includeMemory = args.includeMemory ?? false;
        const outputName = args.outputName || `${agentName}-package`;

        // Check if agent exists
        const pluginDir = await getAgentPluginDir(agentName);
        const mdPath = await getAgentMdPath(agentName);

        if (!pluginDir && !mdPath) {
          return `Error: Agent "${agentName}" not found. It must exist as either a plugin or .md file.`;
        }

        const mode = pluginDir ? "plugin" : "md";

        // Create package directory
        const packageDir = getPackageDir();
        await mkdir(packageDir, { recursive: true });

        // Create temporary staging directory
        const stagingDir = join(packageDir, `.staging-${agentName}-${Date.now()}`);
        await mkdir(stagingDir, { recursive: true });

        try {
          const manifest: PackageManifest = {
            version: "1.0",
            agentName,
            packagedAt: Date.now(),
            mode,
            includesMemory: includeMemory,
            files: [],
          };

          // Copy agent files
          if (mode === "plugin" && pluginDir) {
            // Copy plugin directory
            const pluginStaging = join(stagingDir, "plugin");
            await mkdir(pluginStaging, { recursive: true });

            // Copy essential files
            const essentialFiles = ["package.json", "dist", "INSTALL.md", "README.md"];
            for (const file of essentialFiles) {
              const srcPath = join(pluginDir, file);
              try {
                const srcStat = await stat(srcPath);
                if (srcStat.isDirectory()) {
                  // Copy directory recursively
                  await copyDir(srcPath, join(pluginStaging, file));
                } else {
                  // Copy file
                  const content = await readFile(srcPath);
                  await writeFile(join(pluginStaging, file), content);
                }
                manifest.files.push(file);
              } catch {
                // File doesn't exist, skip
              }
            }
          } else if (mode === "md" && mdPath) {
            // Copy .md file
            const mdContent = await readFile(mdPath, "utf-8");
            await writeFile(join(stagingDir, `${agentName}.md`), mdContent);
            manifest.files.push(`${agentName}.md`);
          }

          // Copy memory files if requested
          if (includeMemory) {
            const memoryFiles = await getAgentMemoryFiles(agentName);
            if (memoryFiles.length > 0) {
              const memoryStaging = join(stagingDir, "memory");

              const configRoot = getConfigRoot();
              const memoryDir = join(configRoot, "hera-data", "memory");

              for (const relPath of memoryFiles) {
                const srcPath = join(memoryDir, relPath);
                const destPath = join(memoryStaging, relPath);
                const destDir = join(memoryStaging, relPath.split(/[/\\]/)[0]);
                await mkdir(destDir, { recursive: true });
                const content = await readFile(srcPath);
                await writeFile(destPath, content);
                manifest.files.push(`memory/${relPath}`);
              }
            }
          }

          // Write manifest
          await writeFile(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2));
          manifest.files.push("manifest.json");

          // Create tar.gz
          const outputPath = join(packageDir, `${outputName}.tar.gz`);
          await createTarGz(stagingDir, outputPath);

          // Clean up staging
          await rm(stagingDir, { recursive: true, force: true });

          const sizeBytes = (await stat(outputPath)).size;
          const sizeKB = (sizeBytes / 1024).toFixed(2);

          return [
            `✓ Agent "${agentName}" packaged successfully!`,
            ``,
            `Package: ${outputPath}`,
            `Size: ${sizeKB} KB`,
            `Mode: ${mode}`,
            `Memory included: ${includeMemory}`,
            `Files: ${manifest.files.length}`,
            ``,
            `To share this agent, send the .tar.gz file.`,
            `To import: use hera_unpack_agent with the file path.`,
          ].join("\n");
        } catch (err: unknown) {
          // Clean up on error
          try {
            await rm(stagingDir, { recursive: true, force: true });
          } catch {}
          return `Error packaging agent: ${errorMessage(err)}`;
        }
      },
    }),

    hera_unpack_agent: tool({
      description:
        "Unpack and install a packaged agent from a .tar.gz file. Restores the agent's plugin code or .md file, and optionally memory data.",
      args: {
        packagePath: z.string().describe("Path to the .tar.gz package file"),
        installPlugin: z
          .boolean()
          .optional()
          .describe("If plugin mode, run 'bun add' to install (default: true)"),
      },
      async execute(args) {
        const packagePath = args.packagePath;
        const installPlugin = args.installPlugin ?? true;

        // Check if package exists
        try {
          await stat(packagePath);
        } catch {
          return `Error: Package file not found: ${packagePath}`;
        }

        // Create temporary extraction directory
        const packageDir = getPackageDir();
        await mkdir(packageDir, { recursive: true });

        const extractDir = join(packageDir, `.extract-${Date.now()}`);
        await mkdir(extractDir, { recursive: true });

        try {
          // Extract package
          const { unsafeEntries } = await extractTarGz(packagePath, extractDir);
          if (unsafeEntries.length > 0) {
            await rm(extractDir, { recursive: true, force: true });
            return `Error: Package contains unsafe path entries and was refused: ${unsafeEntries.join(", ")}`;
          }

          // Read manifest
          const manifestPath = join(extractDir, "manifest.json");
          let rawManifest: unknown;
          try {
            const manifestContent = await readFile(manifestPath, "utf-8");
            rawManifest = JSON.parse(manifestContent);
          } catch {
            await rm(extractDir, { recursive: true, force: true });
            return "Error: Package is missing a readable manifest.json.";
          }

          const manifestCheck = validateManifest(rawManifest);
          if (!manifestCheck.valid) {
            await rm(extractDir, { recursive: true, force: true });
            return `Error: ${manifestCheck.error}`;
          }
          const manifest = manifestCheck.manifest;

          const { agentName, mode, includesMemory } = manifest;

          const configRoot = getConfigRoot();
          const results: string[] = [];

          // Restore agent files
          if (mode === "plugin") {
            const pluginSrc = join(extractDir, "plugin");
            const pluginDest = join(configRoot, "node_modules", agentName);

            // Copy plugin files
            await mkdir(pluginDest, { recursive: true });
            await copyDir(pluginSrc, pluginDest);
            results.push(`✓ Plugin files restored to ${pluginDest}`);

            // Install plugin if requested
            if (installPlugin) {
              results.push(`\nTo complete installation, run:`);
              results.push(`  cd ${configRoot}`);
              results.push(`  bun add file://${pluginDest}`);
            }
          } else if (mode === "md") {
            const mdSrc = join(extractDir, `${agentName}.md`);
            const mdDest = join(configRoot, "agents", "hera", `${agentName}.md`);

            await mkdir(join(configRoot, "agents", "hera"), { recursive: true });
            const content = await readFile(mdSrc, "utf-8");
            await writeFile(mdDest, content);
            results.push(`✓ Agent .md file restored to ${mdDest}`);
          }

          // Restore memory files if included
          if (includesMemory) {
            const memorySrc = join(extractDir, "memory");
            try {
              await stat(memorySrc);
              const memoryDest = join(configRoot, "hera-data", "memory");
              await copyDir(memorySrc, memoryDest);
              results.push(`✓ Memory data restored`);
            } catch {
              // No memory directory in package
            }
          }

          // Clean up
          await rm(extractDir, { recursive: true, force: true });

          return [
            `✓ Agent "${agentName}" unpacked successfully!`,
            ``,
            ...results,
            ``,
            `Agent is now available. Restart OpenCode or reload agents to use it.`,
          ].join("\n");
        } catch (err: unknown) {
          // Clean up on error
          try {
            await rm(extractDir, { recursive: true, force: true });
          } catch {}
          return `Error unpacking agent: ${errorMessage(err)}`;
        }
      },
    }),

    hera_list_packages: tool({
      description: "List all packaged agents in the packages directory.",
      args: {},
      async execute() {
        const packageDir = getPackageDir();

        try {
          await mkdir(packageDir, { recursive: true });
          const files = await readdir(packageDir);
          const packages = files.filter((f) => f.endsWith(".tar.gz"));

          if (packages.length === 0) {
            return "No packaged agents found.";
          }

          const results: string[] = ["Packaged agents:", ""];

          for (const pkg of packages) {
            const pkgPath = join(packageDir, pkg);
            const stats = await stat(pkgPath);
            const sizeKB = (stats.size / 1024).toFixed(2);
            const date = stats.mtime.toISOString().split("T")[0];
            results.push(`  ${pkg} (${sizeKB} KB, ${date})`);
          }

          results.push("");
          results.push(`Location: ${packageDir}`);

          return results.join("\n");
        } catch (err: unknown) {
          return `Error listing packages: ${errorMessage(err)}`;
        }
      },
    }),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Recursively copy directory
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
  }
}
