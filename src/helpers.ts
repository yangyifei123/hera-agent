/**
 * Hera Shared Helpers
 * Centralized utility functions used across agents, tools, and plugin entry.
 */

import type { AgentConfig } from "@opencode-ai/sdk";
import type { SkillDefinition } from "./types.js";
import { DEFAULT_SKILLS, DEFAULT_PERMISSION } from "./constants.js";

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
