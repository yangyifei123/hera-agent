/**
 * SkillAnalyzer — Analyzes, decomposes, and detects conflicts between skills.
 *
 * Part of the analyzer module (T2.1).
 */

import type { SkillPackage } from "../types.js";

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  /** Capabilities identified from the skill's prompt and metadata */
  capabilities: string[];
  /** Names of other skills this one depends on */
  dependencies: string[];
  /** Conflicts found with other skills (only populated in detectConflicts) */
  conflicts: ConflictReport[];
  /** Overall complexity assessment */
  complexity: "simple" | "medium" | "complex";
  /** Improvement suggestions */
  recommendations: string[];
}

export interface ConflictReport {
  skill: string;
  type: "overlap" | "contradiction" | "duplicate";
  description: string;
  severity: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Well-known capability keywords extracted from skill prompts.
 * Each keyword maps to a human-readable capability label.
 */
const CAPABILITY_KEYWORDS: Record<string, string> = {
  review: "code review",
  test: "testing",
  testing: "testing",
  tests: "testing",
  debug: "debugging",
  debugging: "debugging",
  analyze: "analysis",
  analysis: "analysis",
  generate: "code generation",
  generation: "code generation",
  optimize: "optimization",
  optimization: "optimization",
  refactor: "refactoring",
  refactoring: "refactoring",
  document: "documentation",
  documentation: "documentation",
  deploy: "deployment",
  deployment: "deployment",
  monitor: "monitoring",
  monitoring: "monitoring",
  design: "design",
  architect: "architecture",
  architecture: "architecture",
  secure: "security",
  security: "security",
  audit: "auditing",
  auditing: "auditing",
  lint: "linting",
  linting: "linting",
  format: "formatting",
  formatting: "formatting",
  migrate: "migration",
  migration: "migration",
  benchmark: "benchmarking",
  benchmarking: "benchmarking",
  profile: "profiling",
  profiling: "profiling",
  search: "search",
  crawl: "web crawling",
  crawling: "web crawling",
  scrape: "web scraping",
  scraping: "web scraping",
  browser: "browser automation",
  email: "email",
  schedule: "scheduling",
  scheduling: "scheduling",
  database: "database",
  api: "API design",
  graphql: "GraphQL",
  rest: "REST",
  cache: "caching",
  caching: "caching",
  authenticate: "authentication",
  authentication: "authentication",
  authorize: "authorization",
  authorization: "authorization",
  containerize: "containerization",
  containerization: "containerization",
  orchestrate: "orchestration",
  orchestration: "orchestration",
  ci: "CI/CD",
  cd: "CI/CD",
  "pull request": "pull request management",
  "code quality": "code quality",
};

/** Pre-compiled regex for keyword extraction. */
const KEYWORD_REGEX = new RegExp(
  `\\b(${Object.keys(CAPABILITY_KEYWORDS)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|")})\\b`,
  "gi"
);

/** Contradiction pattern pairs. */
const CONTRADICTION_PAIRS: Array<[RegExp, RegExp, string]> = [
  [
    /\buse (?:TypeScript|ts)\b/i,
    /\buse (?:JavaScript|js)\b/i,
    "Language preference conflict (TypeScript vs JavaScript)",
  ],
  [
    /\buse (?:SQL|relational)\b/i,
    /\buse (?:NoSQL|MongoDB|document)\b/i,
    "Database paradigm conflict (SQL vs NoSQL)",
  ],
  [/\buse (?:React)\b/i, /\buse (?:Vue|Svelte|Angular)\b/i, "Frontend framework conflict"],
  [
    /\buse (?:class)\b/i,
    /\buse (?:functional|hooks)\b/i,
    "Programming paradigm conflict (OOP vs functional)",
  ],
  [/\balways\b.*\buse\b/i, /\bnever\b.*\buse\b/i, "Contradictory directives (always vs never)"],
  [/\bprefer\b.*\bimport\b/i, /\bprefer\b.*\brequire\b/i, "Module system conflict (ESM vs CJS)"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// SkillAnalyzer
// ---------------------------------------------------------------------------

export class SkillAnalyzer {
  analyze(skill: SkillPackage): AnalysisResult {
    const capabilities = this.extractCapabilities(skill);
    const dependencies = skill.dependencies.map((d) => d.name);
    const complexity = this.assessComplexity(skill);
    const recommendations = this.generateRecommendations(skill, capabilities, dependencies);

    return { capabilities, dependencies, conflicts: [], complexity, recommendations };
  }

  decompose(skill: SkillPackage): SkillPackage[] {
    const capabilities = this.extractCapabilities(skill);

    if (capabilities.length <= 1) {
      return [{ ...skill }];
    }

    return capabilities.map((cap) => ({
      ...skill,
      name: `${skill.name}--${cap.replace(/\s+/g, "-")}`,
      description: `[${cap}] ${skill.description}`,
      prompt: this.filterPromptForCapability(skill.prompt, cap),
      dependencies: [...skill.dependencies],
      files: this.filterFilesForCapability(skill.files, cap),
      scripts: this.filterScriptsForCapability(skill.scripts, cap),
      metadata: { ...skill.metadata, tags: [...(skill.metadata.tags ?? []), "atomic", cap] },
      config: { ...skill.config, decomposed: true, parentSkill: skill.name },
    }));
  }

  detectConflicts(skills: SkillPackage[]): ConflictReport[] {
    const conflicts: ConflictReport[] = [];

    for (let i = 0; i < skills.length; i++) {
      for (let j = i + 1; j < skills.length; j++) {
        const a = skills[i];
        const b = skills[j];
        if (a.name === b.name) continue;

        // --- Overlap ---
        const capsA = new Set(this.extractCapabilities(a));
        const capsB = new Set(this.extractCapabilities(b));
        const overlap = [...capsA].filter((c) => capsB.has(c));

        if (overlap.length > 0) {
          conflicts.push({
            skill: `${a.name} ↔ ${b.name}`,
            type: "overlap",
            description: `Shared capabilities: ${overlap.join(", ")}`,
            severity: overlap.length >= 3 ? "high" : "medium",
          });
        }

        // --- Contradiction ---
        for (const [regexA, regexB, desc] of CONTRADICTION_PAIRS) {
          const matchA = regexA.test(a.prompt);
          const matchB = regexB.test(b.prompt);
          const matchBA = regexA.test(b.prompt);
          const matchAB = regexB.test(a.prompt);

          if ((matchA && matchB) || (matchBA && matchAB)) {
            conflicts.push({
              skill: `${a.name} ↔ ${b.name}`,
              type: "contradiction",
              description: desc,
              severity: "high",
            });
          }
        }

        // --- Duplicate ---
        if (this.isDuplicate(a, b)) {
          conflicts.push({
            skill: `${a.name} ↔ ${b.name}`,
            type: "duplicate",
            description: "Skills appear to be functionally identical",
            severity: "high",
          });
        }
      }
    }

    return conflicts;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Extract capabilities by matching keyword patterns, then deduplicate
   * by canonical label (e.g., "test" and "testing" both produce "testing").
   */
  private extractCapabilities(skill: SkillPackage): string[] {
    const text = `${skill.prompt} ${skill.description} ${(skill.trigger.keywords ?? []).join(" ")}`;
    const matches = text.match(KEYWORD_REGEX);
    if (!matches) return [];

    // Deduplicate by canonical label
    const seen = new Set<string>();
    const capabilities: string[] = [];
    for (const m of matches) {
      const key = m.toLowerCase();
      const label = CAPABILITY_KEYWORDS[key] ?? key;
      if (!seen.has(label)) {
        seen.add(label);
        capabilities.push(label);
      }
    }
    return capabilities;
  }

  private assessComplexity(skill: SkillPackage): "simple" | "medium" | "complex" {
    const fileCount = skill.files.length;
    const scriptCount = skill.scripts.length;
    const depCount = skill.dependencies.length;

    if (fileCount <= 2 && scriptCount === 0 && depCount === 0) return "simple";
    if (fileCount <= 5 && scriptCount <= 2 && depCount <= 3) return "medium";
    return "complex";
  }

  private generateRecommendations(
    skill: SkillPackage,
    capabilities: string[],
    dependencies: string[]
  ): string[] {
    const recs: string[] = [];

    if (skill.scripts.length === 0 && capabilities.length > 1) {
      recs.push("Consider adding automation scripts for multi-capability skill");
    }
    if (skill.files.length === 0) {
      recs.push("Add reference files or templates to improve skill reliability");
    }
    if (dependencies.length > 5) {
      recs.push("Reduce dependency count to improve portability");
    }
    if (skill.files.length > 5) {
      recs.push("Consider decomposing this skill into smaller atomic skills");
    }
    if (capabilities.length === 0) {
      recs.push("No clear capabilities detected — improve prompt with specific action keywords");
    }
    if (skill.trigger.keywords.length === 0 && skill.trigger.patterns.length === 0) {
      recs.push("Add trigger keywords or patterns so agents can auto-activate this skill");
    }

    return recs;
  }

  /**
   * Duplicate heuristic:
   *  - Exact prompt+description match, OR
   *  - Same dep count, deps match, identical capability sets, and high similarity
   */
  private isDuplicate(a: SkillPackage, b: SkillPackage): boolean {
    // Exact prompt match is a strong duplicate signal
    if (a.prompt === b.prompt && a.description === b.description) {
      return true;
    }

    if (a.dependencies.length !== b.dependencies.length) return false;
    const depsMatch =
      a.dependencies.length === 0 ||
      a.dependencies.every((da) => b.dependencies.some((db) => db.name === da.name));
    if (!depsMatch) return false;

    const capsA = new Set(this.extractCapabilities(a));
    const capsB = new Set(this.extractCapabilities(b));
    if (capsA.size === 0 && capsB.size === 0) return false;
    if (capsA.size !== capsB.size) return false;

    const capOverlap = [...capsA].filter((c) => capsB.has(c)).length;
    const capSimilarity = capOverlap / Math.max(capsA.size, capsB.size);

    return capSimilarity >= 0.8;
  }

  private filterPromptForCapability(prompt: string, capability: string): string {
    const sections = prompt.split(/\n(?=#{1,3}\s|\n{2,})/);
    const relevant = sections.filter((section) => {
      const lower = section.toLowerCase();
      const words = capability.split(/\s+/);
      return words.some((w) => lower.includes(w.toLowerCase()));
    });
    return relevant.length > 0 ? relevant.join("\n\n") : prompt;
  }

  private filterFilesForCapability(
    files: SkillPackage["files"],
    _capability: string
  ): SkillPackage["files"] {
    return files.filter((f) => f.type === "config" || f.type === "reference");
  }

  private filterScriptsForCapability(
    scripts: SkillPackage["scripts"],
    _capability: string
  ): SkillPackage["scripts"] {
    return scripts.length > 0 ? [scripts[0]] : [];
  }
}
