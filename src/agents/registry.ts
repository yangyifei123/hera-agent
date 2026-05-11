import { writeFile, mkdir, readdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentDefinition,
  AgentMode,
  SkillDefinition,
  EvolutionEntry,
} from "../types.js";
import { buildAgentPrompt } from "./hera.js";

export class AgentRegistry {
  private agentsDir: string;

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.agentsDir, { recursive: true });
  }

  async register(
    def: AgentDefinition,
    skills: Map<string, SkillDefinition>
  ): Promise<{ config: Record<string, any>; fileWritten: string }> {
    const resolvedSkills = def.skills
      .map((name) => skills.get(name))
      .filter(Boolean) as SkillDefinition[];

    const fullPrompt = buildAgentPrompt(def, resolvedSkills);

    const frontmatter = this.buildFrontmatter(def);
    const content = frontmatter + fullPrompt;
    const filePath = join(this.agentsDir, `${def.name}.md`);
    await writeFile(filePath, content, "utf-8");

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

  async unregister(name: string): Promise<boolean> {
    try {
      await unlink(join(this.agentsDir, `${name}.md`));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure hera.md exists for OpenCode native discovery (weq agent list)
   */
  async ensureHeraMd(config: any): Promise<void> {
    const filePath = join(this.agentsDir, "hera.md");
    try {
      await readFile(filePath, "utf-8");
      return; // already exists
    } catch {
      // write it
      const content = [
        "---",
        `name: hera`,
        `description: "Hera — Agent Factory. Creates agents, skills, teams. Distills sessions. Self-evolving."`,
        `mode: primary`,
        "---",
        "",
        "# Hera — Agent Factory",
        "",
        "You are Hera. Use `weq --agent hera` to start.",
        "",
        "## Quick Commands",
        "- Create agent: `hera_create_agent`",
        "- List agents: `hera_list_agents`",
        "- Create team: `hera_create_team`",
        "- Evolve agent: `hera_evolve_agent`",
        "",
      ].join("\n");
      await writeFile(filePath, content, "utf-8");
    }
  }

  async listRegistered(): Promise<string[]> {
    try {
      const files = await readdir(this.agentsDir);
      return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  }

  async readDefinition(name: string): Promise<AgentDefinition | null> {
    try {
      const content = await readFile(join(this.agentsDir, `${name}.md`), "utf-8");
      return this.parseMarkdownAgent(content);
    } catch {
      return null;
    }
  }

  async appendEvolution(name: string, entry: EvolutionEntry): Promise<boolean> {
    const def = await this.readDefinition(name);
    if (!def) return false;
    if (!def.evolutionLog) def.evolutionLog = [];
    def.evolutionLog.push(entry);
    def.evolvedAt = Date.now();
    // Re-write the full file
    const filePath = join(this.agentsDir, `${name}.md`);
    const content = await readFile(filePath, "utf-8");
    // Find and update evolution section
    const updated = this.injectEvolutionBlock(content, def.evolutionLog);
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  private buildFrontmatter(def: AgentDefinition): string {
    const lines = ["---"];
    lines.push(`name: ${def.name}`);
    lines.push(`description: "${def.description.replace(/"/g, '\\"')}"`);
    lines.push(`mode: ${def.mode}`);
    if (def.model) lines.push(`model: ${def.model}`);
    if (def.maxSteps) lines.push(`maxSteps: ${def.maxSteps}`);
    if (def.template) lines.push(`template: ${def.template}`);
    if (def.createdAt) lines.push(`createdAt: ${def.createdAt}`);
    if (def.evolvedAt) lines.push(`evolvedAt: ${def.evolvedAt}`);
    lines.push("---", "");
    return lines.join("\n");
  }

  private parseMarkdownAgent(content: string): AgentDefinition {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
      return {
        name: "unknown",
        description: "",
        mode: "subagent",
        prompt: content,
        skills: ["caveman", "init", "memory", "evolution"],
      };
    }

    const [, fm, body] = fmMatch;
    const get = (key: string): string | undefined => {
      const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m?.[1]?.trim()?.replace(/^"(.*)"$/, "$1");
    };

    return {
      name: get("name") ?? "unknown",
      description: get("description") ?? "",
      mode: (get("mode") as AgentMode) ?? "subagent",
      prompt: body.trim(),
      model: get("model"),
      skills: ["caveman", "init", "memory", "evolution"],
      maxSteps: get("maxSteps") ? parseInt(get("maxSteps")!) : 30,
      template: get("template") as any,
      createdAt: get("createdAt") ? parseInt(get("createdAt")!) : undefined,
      evolvedAt: get("evolvedAt") ? parseInt(get("evolvedAt")!) : undefined,
      evolutionLog: [],
    };
  }

  private injectEvolutionBlock(
    content: string,
    entries: EvolutionEntry[]
  ): string {
    const active = entries.filter((e) => !e.rolledBack);
    if (active.length === 0) return content;

    const block = [
      "",
      "## Evolved Directives",
      "",
      ...active.map(
        (e, i) =>
          `${i + 1}. [${new Date(e.timestamp).toISOString()}] ${e.directive}`
      ),
      "",
    ].join("\n");

    // Replace existing evolution block or append
    const marker = "## Evolved Directives";
    const idx = content.indexOf(marker);
    if (idx !== -1) {
      // Find next ## heading after the block
      const afterMarker = content.indexOf("\n## ", idx + marker.length);
      const before =
        afterMarker !== -1 ? content.slice(0, idx) : content.slice(0, idx);
      const after =
        afterMarker !== -1 ? content.slice(afterMarker) : "";
      return before + block + after;
    }
    return content + block;
  }
}
