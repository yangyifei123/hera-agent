// Agent Registry — Write agents as .md files for OpenCode native discovery
//
// OpenCode scans ~/.config/opencode/agents/**/*.md on startup.
// Each file is a markdown agent with YAML frontmatter:
//   ---
//   name: my-agent
//   description: ...
//   mode: subagent
//   ---
//   System prompt body...
//
// This means Hera-created agents appear in `opencode list agent`
// and are usable with `opencode --agent my-agent` without any config edits.

import { writeFile, mkdir, readdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition, AgentMode, SkillDefinition } from "../types.js";
import { getCavemanPrompt } from "../skills/caveman.js";

export class AgentRegistry {
  /** ~/.config/opencode/agents/hera/ */
  private agentsDir: string;

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true });
  }

  /**
   * Register a new agent:
   * 1. Write a .md file to ~/.config/opencode/agents/hera/<name>.md
   * 2. The file is picked up by OpenCode's agent scanner on next startup
   * 3. Also return the AgentConfig for injection via the config hook (immediate availability)
   */
  async register(
    def: AgentDefinition,
    skills: Map<string, SkillDefinition>
  ): Promise<{ config: Record<string, any>; fileWritten: string }> {
    // Resolve skill prompts
    const resolvedSkills = def.skills
      .map((name) => skills.get(name))
      .filter(Boolean) as SkillDefinition[];

    // Build the full system prompt with embedded skills
    const fullPrompt = this.buildPrompt(def, resolvedSkills);

    // Write the markdown agent file
    const frontmatter = [
      "---",
      `name: ${def.name}`,
      `description: ${def.description}`,
      `mode: ${def.mode}`,
    ];
    if (def.model) frontmatter.push(`model: ${def.model}`);
    if (def.maxSteps) frontmatter.push(`maxSteps: ${def.maxSteps}`);
    if (def.tools) frontmatter.push(`tools:\n${Object.entries(def.tools).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
    frontmatter.push("---", "");

    const content = frontmatter.join("\n") + fullPrompt;
    const filePath = join(this.agentsDir, `${def.name}.md`);
    await writeFile(filePath, content, "utf-8");

    // Also return AgentConfig for config hook injection (immediate availability in current session)
    const config: Record<string, any> = {
      description: def.description,
      mode: def.mode,
      prompt: fullPrompt,
      temperature: 0.3,
      maxSteps: def.maxSteps ?? 30,
      permission: {
        edit: "allow" as const,
        bash: "allow" as const,
        webfetch: "allow" as const,
      },
    };
    if (def.model) config.model = def.model;

    return { config, fileWritten: filePath };
  }

  /**
   * Unregister an agent by deleting its .md file
   */
  async unregister(name: string): Promise<boolean> {
    try {
      const filePath = join(this.agentsDir, `${name}.md`);
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all Hera-registered agents by scanning the agents dir
   */
  async listRegistered(): Promise<string[]> {
    try {
      const files = await readdir(this.agentsDir);
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  }

  /**
   * Read an agent's definition from its .md file
   */
  async readDefinition(name: string): Promise<AgentDefinition | null> {
    try {
      const content = await readFile(join(this.agentsDir, `${name}.md`), "utf-8");
      return this.parseMarkdownAgent(content);
    } catch {
      return null;
    }
  }

  /**
   * Parse a markdown agent file into an AgentDefinition
   */
  private parseMarkdownAgent(content: string): AgentDefinition {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return { name: "unknown", description: "", mode: "subagent", prompt: content, skills: ["caveman"] };
    }

    const [, fm, body] = frontmatterMatch;
    const getFm = (key: string): string | undefined => {
      const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m?.[1]?.trim();
    };

    const toolsMatch = fm.match(/^tools:\s*$/m);

    return {
      name: getFm("name") ?? "unknown",
      description: getFm("description") ?? "",
      mode: (getFm("mode") as AgentMode) ?? "subagent",
      prompt: body.trim(),
      model: getFm("model"),
      skills: ["caveman"],
      maxSteps: getFm("maxSteps") ? parseInt(getFm("maxSteps")!) : 30,
    };
  }

  /**
   * Build full system prompt with embedded skills
   */
  private buildPrompt(def: AgentDefinition, skills: SkillDefinition[]): string {
    const sections: string[] = [];

    sections.push(`# Agent: ${def.name}`);
    sections.push("");
    sections.push(def.prompt);
    sections.push("");

    // Always embed caveman
    sections.push("## Built-in Skill: Caveman");
    sections.push(getCavemanPrompt());
    sections.push("");

    // Embed additional skills
    for (const skill of skills) {
      if (skill.name === "caveman") continue; // already embedded
      sections.push(`## Skill: ${skill.name}`);
      sections.push(skill.prompt);
      sections.push("");
    }

    sections.push("## Memory");
    sections.push("You have persistent memory. Use `hera_remember` to store and `hera_recall` to retrieve.");

    return sections.join("\n");
  }
}
