/**
 * Hera Persistence Layer
 * Unified agent persist/remove/backup/restore operations replacing scattered calls.
 */

import type { AgentDefinition, SkillDefinition } from "./types.js";
import type { AgentRegistry } from "./agents/registry.js";
import type { MemoryStore } from "./memory/store.js";
import { mkdir, readdir, writeFile, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { heraLog } from "./logger.js";

export interface PersistResult {
  config: Record<string, any>;
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
 * Get the backups directory path for a given agents directory.
 */
function getBackupsDir(agentsDir: string): string {
  return join(agentsDir, "..", "hera-data", "backups");
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
  registeredAgents.set(def.name, def);
  const { config, fileWritten } = await agentRegistry.register(def, skills);
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

  const agentsDir = (agentRegistry as any).agentsDir as string | undefined;
  if (!agentsDir) {
    heraLog("debug", `Cannot backup agent "${name}": agentsDir not accessible`);
    return;
  }

  const backupsDir = getBackupsDir(agentsDir);
  await mkdir(backupsDir, { recursive: true });

  const timestamp = Date.now();
  const filePath = join(backupsDir, `${name}-${timestamp}.json`);
  const content = JSON.stringify(def, null, 2);
  await writeFile(filePath, content, "utf-8");

  // Prune old backups: keep only last MAX_BACKUPS_PER_AGENT
  try {
    const files = await readdir(backupsDir);
    const agentBackups = files
      .filter((f) => f.startsWith(`${name}-`) && f.endsWith(".json"))
      .sort();

    while (agentBackups.length > MAX_BACKUPS_PER_AGENT) {
      const oldest = agentBackups.shift()!;
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
  const agentsDir = (agentRegistry as any).agentsDir as string | undefined;
  if (!agentsDir) return [];

  const backupsDir = getBackupsDir(agentsDir);
  try {
    const files = await readdir(backupsDir);
    const agentBackups = files
      .filter((f) => f.startsWith(`${name}-`) && f.endsWith(".json"))
      .sort();

    return agentBackups.map((f) => {
      const match = f.match(/-(\d+)\.json$/);
      const timestamp = match ? parseInt(match[1], 10) : 0;
      return { timestamp, filePath: join(backupsDir, f) };
    });
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
  registeredAgents: Map<string, AgentDefinition>,
  agentRegistry: AgentRegistry,
  store: MemoryStore
): Promise<RestoreResult> {
  const agentsDir = (agentRegistry as any).agentsDir as string | undefined;
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
      return { success: false, message: `Backup file "${backupFilePath}" contains invalid agent definition.` };
    }

    const skillsMap = await agentRegistry.listSkillMap?.() ?? new Map<string, SkillDefinition>();
    const { fileWritten } = await persistAgent(def, skillsMap, registeredAgents, agentRegistry, store);
    return {
      success: true,
      message: `Agent "${def.name}" restored from backup. Persisted to ${fileWritten}.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to restore agent "${name}": ${err?.message ?? String(err)}`,
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
