import { writeFile, mkdir, readdir, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentDefinition,
  AgentMode,
  SkillDefinition,
  EvolutionEntry,
  AgentTemplateName,
} from "../types.js";
import { buildAgentPrompt } from "./hera.js";
import { getDefaultSkills, getDefaultPermission } from "../helpers.js";
import { heraLog } from "../logger.js";

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
  ): Promise<{ config: Record<string, unknown>; fileWritten: string }> {
    const resolvedSkills = def.skills
      .map((name) => skills.get(name))
      .filter((skill): skill is SkillDefinition => skill !== undefined);

    const fullPrompt = buildAgentPrompt(def, resolvedSkills);

    const frontmatter = this.buildFrontmatter(def);
    const content = frontmatter + fullPrompt;
    const filePath = join(this.agentsDir, `${def.name}.md`);
    await writeFile(filePath, content, "utf-8");

    const config: Record<string, unknown> = {
      description: def.description,
      mode: def.mode,
      prompt: fullPrompt,
      temperature: 0.3,
      maxSteps: def.maxSteps ?? 30,
      permission: getDefaultPermission(),
    };
    if (def.model) config.model = def.model;

    return { config, fileWritten: filePath };
  }

  async unregister(name: string): Promise<boolean> {
    try {
      await unlink(join(this.agentsDir, `${name}.md`));
      return true;
    } catch (err) {
      heraLog("debug", `Failed to unregister agent: ${name}`, err);
      return false;
    }
  }

  /**
   * Ensure hera.md exists for OpenCode native discovery (opencode agent list)
   */
  getAgentsDir(): string {
    return this.agentsDir;
  }

  async ensureHeraMd(config: { default_model?: string }): Promise<void> {
    const filePath = join(this.agentsDir, "hera.md");
    // Always overwrite to ensure correct content
    const modelLine = config.default_model ? `model: ${config.default_model}` : "";
    const content = [
      "---",
      `name: hera`,
      `description: "Hera — Agent Factory. Creates agents, skills, teams. Distills sessions. Self-evolving."`,
      `mode: primary`,
      modelLine,
      "---",
      "",
      "# Hera — Agent Factory",
      "",
      "You are Hera, the Agent Factory. You create autonomous agents with persistent memory.",
      "",
      "## Your Capabilities",
      "- **Create Agents**: Use templates (general, coder, reviewer, researcher, coordinator) or custom prompts",
      "- **Manage Skills**: Create reusable skills and upgrade them to full agents",
      "- **Build Teams**: Organize agents into collaborative teams with parallel/sequential coordination",
      "- **Self-Evolution**: Agents can improve themselves through reflection",
      "- **Persistent Memory**: All agents and teams survive restarts",
      "",
      "## Quick Start",
      "```",
      "# Create an agent from template",
      "hera_create_agent(name='my-coder', description='Coding expert', template='coder', mode='all')",
      "",
      "# Create a custom agent",
      "hera_create_agent(name='sentinel', description='Security auditor', prompt='You are a security expert...', mode='subagent')",
      "",
      "# Create a team",
      "hera_create_team(name='review-squad', description='Code review team', coordination='parallel', members=[...])",
      "```",
      "",
      "## Available Tools",
      "- `hera_create_agent` - Create new agent",
      "- `hera_list_agents` - List all agents",
      "- `hera_delete_agent` - Remove agent",
      "- `hera_spawn_agent` - Launch agent session",
      "- `hera_create_skill` - Create skill",
      "- `hera_list_skills` - List skills",
      "- `hera_upgrade_to_agent` - Upgrade skills to agent",
      "- `hera_create_team` - Create team",
      "- `hera_spawn_team` - Launch team task",
      "- `hera_evolve_agent` - Add evolution directive",
      "- `hera_remember` - Store memory",
      "- `hera_recall` - Search memory",
      "",
    ].join("\n");
    await writeFile(filePath, content, "utf-8");
  }

  async listRegistered(): Promise<string[]> {
    try {
      const files = await readdir(this.agentsDir);
      return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    } catch (err) {
      heraLog("debug", `Failed to list registered agents in ${this.agentsDir}`, err);
      return [];
    }
  }

  async readDefinition(name: string): Promise<AgentDefinition | null> {
    try {
      const content = await readFile(join(this.agentsDir, `${name}.md`), "utf-8");
      return this.parseMarkdownAgent(content);
    } catch (err) {
      heraLog("debug", `Failed to read definition for agent: ${name}`, err);
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
    // Collapse newlines/control chars before quoting: an un-sanitized newline in
    // the description would inject arbitrary frontmatter keys (mode, permission,
    // ...) that parseMarkdownAgent reads back on the next reload.
    const safeDescription = def.description
      .replace(/[\r\n\t]+/g, " ")
      .replace(/"/g, '\\"')
      .trim();
    lines.push(`description: "${safeDescription}"`);
    lines.push(`mode: ${def.mode}`);
    // Persist the RAW author prompt (base64, newline/quote-safe) so it round-trips
    // on reload instead of def.prompt becoming the fully-rendered body (which
    // already embeds the built-in skills). Without this, the config hook re-adds
    // the skills on top of the body and every agent ships them twice.
    if (def.prompt) lines.push(`promptB64: ${Buffer.from(def.prompt, "utf-8").toString("base64")}`);
    if (def.model) lines.push(`model: ${def.model}`);
    if (def.maxSteps) lines.push(`maxSteps: ${def.maxSteps}`);
    if (def.template) lines.push(`template: ${def.template}`);
    if (def.createdAt) lines.push(`createdAt: ${def.createdAt}`);
    if (def.evolvedAt) lines.push(`evolvedAt: ${def.evolvedAt}`);
    if (def.skills.length > 0) lines.push(`skillsJson: ${jsonFrontmatter(def.skills)}`);
    if (def.tools) lines.push(`toolsJson: ${jsonFrontmatter(def.tools)}`);
    if (def.permission) lines.push(`permissionJson: ${jsonFrontmatter(def.permission)}`);
    if (def.evolutionLog && def.evolutionLog.length > 0) {
      lines.push(`evolutionLogJson: ${jsonFrontmatter(def.evolutionLog)}`);
    }
    if (def.workflow) lines.push(`workflowJson: ${jsonFrontmatter(def.workflow)}`);
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
        skills: getDefaultSkills(),
      };
    }

    const [, fm, body] = fmMatch;
    const get = (key: string): string | undefined => {
      const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m?.[1]?.trim()?.replace(/^"(.*)"$/, "$1");
    };

    const promptB64 = get("promptB64");
    const rawPrompt =
      promptB64 !== undefined ? Buffer.from(promptB64, "base64").toString("utf-8") : undefined;
    const maxSteps = get("maxSteps");
    const createdAt = get("createdAt");
    const evolvedAt = get("evolvedAt");
    const template = get("template");
    const parsedSkills = parseJsonField<string[]>(get("skillsJson"), isStringArray);
    const parsedTools = parseJsonField<Record<string, boolean>>(get("toolsJson"), isBooleanRecord);
    const parsedPermission = parseJsonField<AgentDefinition["permission"]>(
      get("permissionJson"),
      isPermissionConfig
    );
    const parsedEvolutionLog = parseJsonField<EvolutionEntry[]>(
      get("evolutionLogJson"),
      isEvolutionEntryArray
    );
    const parsedWorkflow = parseJsonField<AgentDefinition["workflow"]>(
      get("workflowJson"),
      isWorkflowDefinition
    );

    return {
      name: get("name") ?? "unknown",
      description: get("description") ?? "",
      mode: (get("mode") as AgentMode) ?? "subagent",
      // Prefer the round-tripped raw prompt; fall back to the body for legacy
      // agents written before promptB64 existed.
      prompt: rawPrompt ?? body.trim(),
      model: get("model"),
      skills: parsedSkills ?? getDefaultSkills(),
      tools: parsedTools,
      permission: parsedPermission,
      maxSteps: maxSteps ? parseInt(maxSteps, 10) : 30,
      template: isAgentTemplateName(template) ? template : undefined,
      createdAt: createdAt ? parseInt(createdAt, 10) : undefined,
      evolvedAt: evolvedAt ? parseInt(evolvedAt, 10) : undefined,
      evolutionLog: parsedEvolutionLog ?? [],
      workflow: parsedWorkflow,
    };
  }

  private injectEvolutionBlock(content: string, entries: EvolutionEntry[]): string {
    const active = entries.filter((e) => !e.rolledBack);
    if (active.length === 0) return content;

    const block = [
      "",
      "## Evolved Directives",
      "",
      ...active.map((e, i) => `${i + 1}. [${new Date(e.timestamp).toISOString()}] ${e.directive}`),
      "",
    ].join("\n");

    // Replace existing evolution block or append
    const marker = "## Evolved Directives";
    const idx = content.indexOf(marker);
    if (idx !== -1) {
      // Find next ## heading after the block
      const afterMarker = content.indexOf("\n## ", idx + marker.length);
      const before = afterMarker !== -1 ? content.slice(0, idx) : content.slice(0, idx);
      const after = afterMarker !== -1 ? content.slice(afterMarker) : "";
      return before + block + after;
    }
    return content + block;
  }
}

function jsonFrontmatter(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function parseJsonField<T>(
  raw: string | undefined,
  guard: (value: unknown) => value is T
): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isObjectLike(value) && Object.values(value).every((item) => typeof item === "boolean");
}

function isPermissionConfig(value: unknown): value is NonNullable<AgentDefinition["permission"]> {
  const allowed = new Set(["allow", "ask", "deny"]);
  return (
    isObjectLike(value) &&
    Object.values(value).every((item) => typeof item === "string" && allowed.has(item))
  );
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvolutionEntryArray(value: unknown): value is EvolutionEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isObjectLike(entry) &&
        typeof entry.timestamp === "number" &&
        typeof entry.trigger === "string" &&
        typeof entry.observation === "string" &&
        typeof entry.directive === "string" &&
        typeof entry.rolledBack === "boolean"
    )
  );
}

function isWorkflowDefinition(value: unknown): value is NonNullable<AgentDefinition["workflow"]> {
  return (
    isObjectLike(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    (value.mode === "serial" || value.mode === "parallel" || value.mode === "dag") &&
    Array.isArray(value.steps) &&
    typeof value.createdAt === "number"
  );
}

function isAgentTemplateName(value: string | undefined): value is AgentTemplateName {
  return (
    value === "general" ||
    value === "coder" ||
    value === "reviewer" ||
    value === "researcher" ||
    value === "coordinator" ||
    value === "architect" ||
    value === "debugger" ||
    value === "tester" ||
    value === "documenter" ||
    value === "optimizer"
  );
}
