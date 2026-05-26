/**
 * Hera Shared Helpers
 * Centralized utility functions used across agents, tools, and plugin entry.
 */

import type { AgentConfig } from "@opencode-ai/sdk";
import type { SkillDefinition } from "./types.js";
import { DEFAULT_SKILLS, DEFAULT_PERMISSION } from "./constants.js";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const writeLocks = new Map<string, Promise<void>>();

/**
 * Returns default skills with optional additional skills, deduplicated via Set.
 * Always returns a new array to prevent shared-reference mutations.
 */
export function getDefaultSkills(additional?: string[]): string[] {
  if (!additional || additional.length === 0) {
    return [...DEFAULT_SKILLS];
  }
  return [...new Set([...DEFAULT_SKILLS, ...additional])];
}

/**
 * Returns a deep copy of the default permission object.
 * Each call returns a fresh object to prevent cross-reference contamination.
 */
export function getDefaultPermission(): AgentConfig["permission"] {
  return { ...DEFAULT_PERMISSION };
}

/**
 * Builds markdown skill embedding sections from skill definitions.
 * Output format: "## Skill: {name}\n{prompt}" joined by "\n\n".
 * Empty array returns empty string.
 */
export function buildSkillPromptEmbedding(skills: SkillDefinition[]): string {
  if (skills.length === 0) return "";
  return skills.map((s) => `## Skill: ${s.name}\n${s.prompt}`).join("\n\n");
}

/**
 * Converts unknown caught values into readable error text.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Atomically writes text by writing a sibling temporary file first, then
 * renaming it over the target. The same-directory rename keeps the operation
 * on one filesystem and prevents partially-written JSON after interruption.
 */
export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  const next = previous.then(() => writeTextAtomically(filePath, content));
  writeLocks.set(
    filePath,
    next.catch(() => undefined)
  );
  try {
    await next;
  } finally {
    if (writeLocks.get(filePath) === next) {
      writeLocks.delete(filePath);
    }
  }
}

async function writeTextAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = join(dirname(filePath), `.hera-tmp-${Date.now()}-${randomUUID()}`);
  try {
    await writeFile(tempPath, content, "utf-8");
    if (process.platform === "win32") {
      try {
        await unlink(filePath);
      } catch {
        // Target may not exist yet.
      }
    }
    await rename(tempPath, filePath);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup only; preserve original write error.
    }
    throw err;
  }
}

/** Writes JSON atomically with Hera's standard readable formatting. */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteText(filePath, JSON.stringify(value, null, 2));
}
