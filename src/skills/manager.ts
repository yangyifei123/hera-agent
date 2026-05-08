// Skill Manager - Load, create, and manage skills

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SkillDefinition } from "../types.js";
import type { MemoryStore } from "../memory/store.js";
import { CAVEMAN_SKILL } from "./caveman.js";

export class SkillManager {
  private store: MemoryStore;
  private skillsDir: string;
  private loadedSkills: Map<string, SkillDefinition> = new Map();

  constructor(store: MemoryStore, skillsDir: string) {
    this.store = store;
    this.skillsDir = skillsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true });
    this.loadedSkills.set("caveman", CAVEMAN_SKILL);

    // Load user-created skills from memory store
    const stored = await this.store.list("skill");
    for (const mem of stored) {
      try {
        const skill = JSON.parse(mem.content) as SkillDefinition;
        this.loadedSkills.set(skill.name, skill);
      } catch {
        // skip
      }
    }
  }

  async createSkill(skill: SkillDefinition): Promise<void> {
    this.loadedSkills.set(skill.name, skill);

    await this.store.save({
      id: `skill-${skill.name}`,
      type: "skill",
      content: JSON.stringify(skill),
      timestamp: Date.now(),
      metadata: { name: skill.name, trigger: skill.trigger },
    });

    const skillDir = join(this.skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        `---`,
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        `---`,
        ``,
        skill.prompt,
      ].join("\n"),
      "utf-8"
    );
  }

  async deleteSkill(name: string): Promise<boolean> {
    if (name === "caveman") return false;
    this.loadedSkills.delete(name);
    await this.store.delete("skill", `skill-${name}`);

    // Remove SKILL.md
    try {
      const skillDir = join(this.skillsDir, name);
      await unlink(join(skillDir, "SKILL.md")).catch(() => {});
    } catch {
      // ok
    }
    return true;
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.loadedSkills.get(name);
  }

  getAllSkills(): SkillDefinition[] {
    return Array.from(this.loadedSkills.values());
  }

  getSkillMap(): Map<string, SkillDefinition> {
    return new Map(this.loadedSkills);
  }

  /**
   * Upgrade one or more skills into an agent prompt
   */
  upgradeSkillsToAgentPrompt(
    agentName: string,
    skillNames: string[],
    description: string
  ): string {
    const skillPrompts = skillNames
      .map((name) => {
        const skill = this.loadedSkills.get(name);
        if (!skill) return null;
        return `## Skill: ${skill.name}\n${skill.prompt}`;
      })
      .filter(Boolean)
      .join("\n\n");

    return [
      `# Agent: ${agentName}`,
      ``,
      description,
      ``,
      `You are an autonomous agent created by Hera. You embody the following skills:`,
      ``,
      skillPrompts,
      ``,
      `## Directives`,
      `- Apply all embedded skills in every response`,
      `- Maintain skill intensity and style consistently`,
      `- Report outcomes concisely`,
      `- Collaborate with team members when asked`,
    ].join("\n");
  }
}
