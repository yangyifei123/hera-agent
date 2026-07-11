/**
 * Hera Persistence Layer
 * Unified agent persist/remove/backup/restore operations replacing scattered calls.
 */

import type { AgentDefinition, SkillDefinition } from "./types.js";
import type { AgentRegistry } from "./agents/registry.js";
import type { MemoryStore } from "./memory/store.js";
import { mkdir, readdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { heraLog } from "./logger.js";
import { atomicWriteJson, errorMessage } from "./helpers.js";

export interface PersistResult {
  config: Record<string, unknown>;
  fileWritten: string;
  memoryId: string;
}

export interface RestoreResult {
  success: boolean;
  message: string;
}

export interface BackupEntry {
  timestamp: number;
  filePath: string;
}

/** Maximum backups per agent */
const MAX_BACKUPS_PER_AGENT = 5;

/**
 * Match ONLY this agent's backup files: `<name>-<digits>.json`. A plain
 * `startsWith("<name>-")` prefix test also matches longer-named agents — e.g.
 * "qa" would match "qa-engineer-123.json" — so restoring/pruning "qa" could
 * clobber "qa-engineer"'s backups. Anchoring the timestamp as all-digits keeps
 * the two namespaces separate even when one name is a prefix of another.
 */
function agentBackupPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-\\d+\\.json$`);
}

/** Parse the trailing `-<digits>.json` timestamp from a backup filename. */
function backupTimestamp(file: string): number {
  const match = file.match(/-(\d+)\.json$/);
  return match ? parseInt(match[1], 10) : 0;
}

function getAgentRegistryDir(agentRegistry: AgentRegistry): string | undefined {
  const maybeRegistry = agentRegistry as { getAgentsDir?: () => string };
  return maybeRegistry.getAgentsDir?.();
}

/**
 * Get the backups directory path for a given agents directory.
 */
function getBackupsDir(agentsDir: string): string {
  return join(agentsDir, "..", "..", "hera-data", "backups");
}

/**
 * Persist an agent to all three storage backends:
 * 1. In-memory registeredAgents map
 * 2. Disk .md file via agentRegistry
 * 3. MemoryStore JSON backup
 */
export async function persistAgent(
  def: AgentDefinition,
  skills: Map<string, SkillDefinition>,
  registeredAgents: Map<string, AgentDefinition>,
  agentRegistry: AgentRegistry,
  store: MemoryStore
): Promise<PersistResult> {
  // Write to disk FIRST, then register in-memory — so a failed disk write does
  // not leave a half-registered agent that blocks re-creating the same name.
  const { config, fileWritten } = await agentRegistry.register(def, skills);
  registeredAgents.set(def.name, def);
  const memoryId = `agent-${def.name}`;
  await store.save({
    id: memoryId,
    type: "agent",
    content: JSON.stringify(def),
    timestamp: Date.now(),
    metadata: { mode: def.mode, skills: def.skills, fileWritten },
  });
  return { config, fileWritten, memoryId };
}

/**
 * Backup an agent definition to a timestamped JSON file.
 * Keeps only the last MAX_BACKUPS_PER_AGENT backups.
 */
export async function backupAgent(
  name: string,
  registeredAgents: Map<string, AgentDefinition>,
  agentRegistry: AgentRegistry
): Promise<void> {
  const def = registeredAgents.get(name);
  if (!def) {
    heraLog("debug", `Cannot backup agent "${name}": not found in registeredAgents`);
    return;
  }

  const agentsDir = getAgentRegistryDir(agentRegistry);
  if (!agentsDir) {
    heraLog("debug", `Cannot backup agent "${name}": agentsDir not accessible`);
    return;
  }

  const backupsDir = getBackupsDir(agentsDir);
  await mkdir(backupsDir, { recursive: true });

  const timestamp = Date.now();
  const filePath = join(backupsDir, `${name}-${timestamp}.json`);
  await atomicWriteJson(filePath, def);

  // Prune old backups: keep only last MAX_BACKUPS_PER_AGENT
  try {
    const files = await readdir(backupsDir);
    const pattern = agentBackupPattern(name);
    const agentBackups = files
      .filter((f) => pattern.test(f))
      .sort((a, b) => backupTimestamp(a) - backupTimestamp(b));

    while (agentBackups.length > MAX_BACKUPS_PER_AGENT) {
      const oldest = agentBackups.shift();
      if (!oldest) break;
      await unlink(join(backupsDir, oldest));
    }
  } catch {
    // ignore prune failure
  }
}

/**
 * List available backups for an agent.
 */
export async function listBackups(
  name: string,
  registeredAgents: Map<string, AgentDefinition>,
  agentRegistry: AgentRegistry
): Promise<BackupEntry[]> {
  const agentsDir = getAgentRegistryDir(agentRegistry);
  if (!agentsDir) return [];

  const backupsDir = getBackupsDir(agentsDir);
  try {
    const files = await readdir(backupsDir);
    const pattern = agentBackupPattern(name);
    const agentBackups = files
      .filter((f) => pattern.test(f))
      .sort((a, b) => backupTimestamp(a) - backupTimestamp(b));

    return agentBackups.map((f) => ({
      timestamp: backupTimestamp(f),
      filePath: join(backupsDir, f),
    }));
  } catch {
    return [];
  }
}

/**
 * Restore an agent from a backup file.
 * If no timestamp provided, uses the most recent backup.
 */
export async function restoreAgent(
  name: string,
  timestamp: number | undefined,
  skills: Map<string, SkillDefinition>,
  registeredAgents: Map<string, AgentDefinition>,
  agentRegistry: AgentRegistry,
  store: MemoryStore
): Promise<RestoreResult> {
  const agentsDir = getAgentRegistryDir(agentRegistry);
  if (!agentsDir) {
    return { success: false, message: "Cannot restore: agents directory not accessible." };
  }

  const backupsDir = getBackupsDir(agentsDir);

  let backupFilePath: string;

  if (timestamp !== undefined) {
    backupFilePath = join(backupsDir, `${name}-${timestamp}.json`);
    // Check if file exists
    try {
      await readFile(backupFilePath, "utf-8");
    } catch {
      return {
        success: false,
        message: `No backup found for agent "${name}" with timestamp ${timestamp}.`,
      };
    }
  } else {
    // Find latest backup
    const backups = await listBackups(name, registeredAgents, agentRegistry);
    if (backups.length === 0) {
      return {
        success: false,
        message: `No backups found for agent "${name}".`,
      };
    }
    backupFilePath = backups[backups.length - 1].filePath;
  }

  try {
    const content = await readFile(backupFilePath, "utf-8");
    const def = JSON.parse(content) as AgentDefinition;
    if (!def.name || !def.description || !def.mode || !def.prompt) {
      return {
        success: false,
        message: `Backup file "${backupFilePath}" contains invalid agent definition.`,
      };
    }

    const { fileWritten } = await persistAgent(def, skills, registeredAgents, agentRegistry, store);
    return {
      success: true,
      message: `Agent "${def.name}" restored from backup. Persisted to ${fileWritten}.`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Failed to restore agent "${name}": ${errorMessage(err)}`,
    };
  }
}

/**
 * Remove an agent from all three storage backends.
 * Creates a backup before deletion for recovery.
 * Returns the result of store.delete().
 */
export async function removeAgent(
  name: string,
  registeredAgents: Map<string, AgentDefinition>,
  agentRegistry: AgentRegistry,
  store: MemoryStore
): Promise<boolean> {
  // Create backup before deletion
  await backupAgent(name, registeredAgents, agentRegistry);
  registeredAgents.delete(name);
  await agentRegistry.unregister(name);
  return store.delete("agent", `agent-${name}`);
}

const LEGACY_BODY_MARKER = "## Built-in Skill:";

/**
 * Reconstruct the raw author prompt from a legacy rendered body. Agent .md
 * files written before promptB64 existed have no round-trippable raw prompt,
 * so parseMarkdownAgent falls back to def.prompt = <entire rendered body>:
 * the "# Agent: <name>" header, the raw prompt, then every embedded legacy
 * skill section (and evolution block). Everything from the first legacy
 * section heading onward is re-renderable from structured fields (skill
 * manifest from def.skills, evolution block from def.evolutionLog), so drop
 * it; also drop the duplicated header that buildAgentPrompt re-adds.
 */
function extractLegacyRawPrompt(prompt: string, name: string): string {
  let raw = prompt;
  const markerIdx = raw.indexOf(LEGACY_BODY_MARKER);
  if (markerIdx !== -1) raw = raw.slice(0, markerIdx);
  const header = `# Agent: ${name}`;
  if (raw.startsWith(header)) raw = raw.slice(header.length);
  return raw.trim();
}

/** Does the file's frontmatter block carry a promptB64 field? */
function frontmatterHasPromptB64(content: string): boolean {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return fm ? /^promptB64:/m.test(fm[1]) : false;
}

/**
 * One-time idempotent migration (spec §5): rewrite agent .md files that still
 * embed full skill bodies to the compact-manifest rendering. Backs up each
 * file first; register() writes atomically. Safe to run every startup — the
 * marker disappears after the first rewrite.
 *
 * Genuine pre-promptB64 files need extra care: their def was parsed via the
 * body fallback, so def.prompt is the whole rendered body (marker, embedded
 * skill bodies, duplicated "# Agent:" header included). Re-registering that
 * verbatim would bake the legacy bodies into promptB64 forever and the marker
 * would never disappear — so the raw prompt is reconstructed first and the
 * in-memory def updated to match what was written.
 */
export async function migrateLegacyAgentMarkdown(
  registeredAgents: Map<string, AgentDefinition>,
  skills: Map<string, SkillDefinition>,
  agentRegistry: AgentRegistry
): Promise<string[]> {
  const migrated: string[] = [];
  for (const [name, def] of registeredAgents) {
    try {
      const content = await agentRegistry.readAgentFile(name);
      if (!content || !content.includes(LEGACY_BODY_MARKER)) continue;
      const promptHasMarker = def.prompt.includes(LEGACY_BODY_MARKER);
      if (promptHasMarker && frontmatterHasPromptB64(content)) {
        // The marker comes from the author's own round-tripped prompt, not
        // from a legacy render: rewriting can never remove it, so migrating
        // would re-backup + rewrite on every startup for nothing.
        heraLog(
          "debug",
          `Agent "${name}" prompt legitimately contains the legacy marker; skipping migration`
        );
        continue;
      }
      await backupAgent(name, registeredAgents, agentRegistry);
      let defToWrite = def;
      if (promptHasMarker) {
        defToWrite = { ...def, prompt: extractLegacyRawPrompt(def.prompt, name) };
        registeredAgents.set(name, defToWrite);
      }
      await agentRegistry.register(defToWrite, skills);
      migrated.push(name);
    } catch (err) {
      heraLog(
        "warn",
        `Legacy prompt migration failed for agent "${name}"; leaving file as-is`,
        err
      );
    }
  }
  if (migrated.length > 0) {
    heraLog(
      "info",
      `Migrated ${migrated.length} agent file(s) to manifest prompts: ${migrated.join(", ")}`
    );
  }
  return migrated;
}
