import { describe, test, expect } from "bun:test";
import { SkillAnalyzer, type AnalysisResult, type ConflictReport } from "./skill-analyzer.js";
import type { SkillPackage } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill for unit testing",
    trigger: { patterns: [], keywords: [] },
    dependencies: [],
    chains: [],
    files: [],
    config: {},
    scripts: [],
    prompt: "This is a test skill prompt.",
    metadata: {},
    ...overrides,
  };
}

const simpleSkill = makeSkill({
  name: "simple-review",
  description: "Review code for bugs",
  prompt: "You are a code reviewer. Review code and find bugs.",
  trigger: { patterns: ["review"], keywords: [] },
});

const mediumSkill = makeSkill({
  name: "medium-dev",
  description: "Generate and test code",
  prompt: "Generate production code and write test cases. Debug issues found.",
  files: [
    { path: "a.ts", type: "script", content: "" },
    { path: "b.ts", type: "config", content: "" },
    { path: "c.ts", type: "reference", content: "" },
  ],
  scripts: [{ name: "build", runtime: "bun", entry: "build.ts" }],
  dependencies: [{ name: "typescript" }],
});

const complexSkill = makeSkill({
  name: "complex-fullstack",
  description: "Full stack development with API, database, and deployment",
  prompt: "Design REST API endpoints. Optimize database queries. Deploy to production. Monitor performance and debug issues.",
  files: Array.from({ length: 7 }, (_, i) => ({
    path: `file${i}.ts`,
    type: "script" as const,
    content: "",
  })),
  scripts: [
    { name: "build", runtime: "bun", entry: "build.ts" },
    { name: "test", runtime: "bun", entry: "test.ts" },
    { name: "deploy", runtime: "bash", entry: "deploy.sh" },
  ],
  dependencies: [
    { name: "react" },
    { name: "express" },
    { name: "postgres" },
    { name: "docker" },
  ],
});

const tsSkill = makeSkill({
  name: "ts-enforcer",
  description: "Enforce TypeScript best practices",
  prompt: "Always use TypeScript for all new files. Prefer import syntax over require.",
  trigger: { patterns: ["typescript"], keywords: [] },
});

const jsSkill = makeSkill({
  name: "js-enforcer",
  description: "Enforce JavaScript simplicity",
  prompt: "Always use JavaScript for simplicity. Prefer require syntax over import.",
  trigger: { patterns: ["javascript"], keywords: [] },
});

const noCapSkill = makeSkill({
  name: "vague-skill",
  description: "Does something unspecified",
  prompt: "Help the user with their tasks.",
  trigger: { patterns: [], keywords: [] },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const analyzer = new SkillAnalyzer();

describe("SkillAnalyzer", () => {
  // =========================================================================
  // analyze()
  // =========================================================================

  describe("analyze()", () => {
    test("extracts capabilities from prompt keywords", () => {
      const result = analyzer.analyze(simpleSkill);
      expect(result.capabilities).toContain("code review");
    });

    test("extracts capabilities from description", () => {
      const skill = makeSkill({
        description: "A tool for debug and testing",
        prompt: "Help developers.",
      });
      const result = analyzer.analyze(skill);
      expect(result.capabilities).toContain("debugging");
      expect(result.capabilities).toContain("testing");
    });

    test("extracts capabilities from trigger keywords", () => {
      const skill = makeSkill({
        prompt: "General purpose.",
        trigger: { patterns: [], keywords: ["optimize", "lint"] },
      });
      const result = analyzer.analyze(skill);
      expect(result.capabilities).toContain("optimization");
      expect(result.capabilities).toContain("linting");
    });

    test("deduplicates capabilities by canonical label", () => {
      // "test" and "testing" should both map to "testing" — only one entry
      const skill = makeSkill({
        description: "test testing debug debugging",
        prompt: "Help developers.",
      });
      const result = analyzer.analyze(skill);
      expect(result.capabilities).toContain("testing");
      expect(result.capabilities).toContain("debugging");
      expect(result.capabilities.filter((c) => c === "testing")).toHaveLength(1);
    });

    test("returns empty capabilities for skill without keywords", () => {
      const result = analyzer.analyze(noCapSkill);
      expect(result.capabilities).toEqual([]);
    });

    test("extracts dependencies correctly", () => {
      const result = analyzer.analyze(mediumSkill);
      expect(result.dependencies).toEqual(["typescript"]);
    });

    test("returns empty dependencies for skill without deps", () => {
      const result = analyzer.analyze(simpleSkill);
      expect(result.dependencies).toEqual([]);
    });

    test("assesses simple complexity correctly", () => {
      const result = analyzer.analyze(simpleSkill);
      expect(result.complexity).toBe("simple");
    });

    test("assesses medium complexity correctly", () => {
      const result = analyzer.analyze(mediumSkill);
      expect(result.complexity).toBe("medium");
    });

    test("assesses complex complexity correctly", () => {
      const result = analyzer.analyze(complexSkill);
      expect(result.complexity).toBe("complex");
    });

    test("returns recommendations array", () => {
      const result = analyzer.analyze(noCapSkill);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    test("recommends improvement for multi-capability skill without scripts", () => {
      const skill = makeSkill({
        prompt: "Review and test code. Debug issues.",
        scripts: [],
        files: [{ path: "a.ts", type: "reference", content: "" }],
      });
      const result = analyzer.analyze(skill);
      expect(result.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("automation scripts")]),
      );
    });

    test("recommends files for skill without files", () => {
      const result = analyzer.analyze(simpleSkill);
      expect(result.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("reference files")]),
      );
    });

    test("recommends reducing dependencies when many", () => {
      const skill = makeSkill({
        prompt: "Do things.",
        dependencies: Array.from({ length: 7 }, (_, i) => ({ name: `dep-${i}` })),
        files: [{ path: "a", type: "config", content: "" }],
      });
      const result = analyzer.analyze(skill);
      expect(result.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("Reduce dependency")]),
      );
    });

    test("recommends decomposing when too many files", () => {
      const skill = makeSkill({
        prompt: "Do things.",
        files: Array.from({ length: 7 }, (_, i) => ({
          path: `f${i}`,
          type: "script" as const,
          content: "",
        })),
      });
      const result = analyzer.analyze(skill);
      expect(result.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("decomposing")]),
      );
    });

    test("recommends improving prompt when no capabilities found", () => {
      const result = analyzer.analyze(noCapSkill);
      expect(result.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("No clear capabilities")]),
      );
    });

    test("recommends trigger keywords when none present", () => {
      const skill = makeSkill({
        prompt: "Review code.",
        trigger: { patterns: [], keywords: [] },
      });
      const result = analyzer.analyze(skill);
      expect(result.recommendations).toEqual(
        expect.arrayContaining([expect.stringContaining("trigger keywords")]),
      );
    });

    test("conflicts field is empty in analyze result", () => {
      const result = analyzer.analyze(simpleSkill);
      expect(result.conflicts).toEqual([]);
    });

    test("extracts multiple capabilities from complex prompt", () => {
      const result = analyzer.analyze(complexSkill);
      expect(result.capabilities.length).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // decompose()
  // =========================================================================

  describe("decompose()", () => {
    test("returns single skill unchanged when already atomic", () => {
      const result = analyzer.decompose(simpleSkill);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("simple-review");
    });

    test("splits multi-capability skill into atomic skills", () => {
      const result = analyzer.decompose(complexSkill);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test("each decomposed skill has atomic name format", () => {
      const result = analyzer.decompose(complexSkill);
      for (const sub of result) {
        expect(sub.name).toContain("--");
      }
    });

    test("each decomposed skill has updated description", () => {
      const result = analyzer.decompose(complexSkill);
      for (const sub of result) {
        expect(sub.description).toMatch(/^\[.+\]/);
      }
    });

    test("decomposed skills keep original dependencies", () => {
      const result = analyzer.decompose(complexSkill);
      for (const sub of result) {
        expect(sub.dependencies.length).toBe(complexSkill.dependencies.length);
      }
    });

    test("decomposed skills have decomposed config flag", () => {
      const result = analyzer.decompose(complexSkill);
      for (const sub of result) {
        expect(sub.config.decomposed).toBe(true);
        expect(sub.config.parentSkill).toBe(complexSkill.name);
      }
    });

    test("decomposed skills have atomic tag in metadata", () => {
      const result = analyzer.decompose(complexSkill);
      for (const sub of result) {
        expect(sub.metadata.tags).toContain("atomic");
      }
    });

    test("returns copy even for atomic skill (no shared reference)", () => {
      const result = analyzer.decompose(simpleSkill);
      expect(result[0]).not.toBe(simpleSkill);
    });

    test("decomposed skill names are all unique", () => {
      const result = analyzer.decompose(complexSkill);
      const names = result.map((s) => s.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });

  // =========================================================================
  // detectConflicts()
  // =========================================================================

  describe("detectConflicts()", () => {
    test("returns empty for single skill", () => {
      const result = analyzer.detectConflicts([simpleSkill]);
      expect(result).toEqual([]);
    });

    test("returns empty for non-overlapping skills", () => {
      const skillA = makeSkill({
        name: "skill-a",
        prompt: "Handle email sending.",
        description: "Email skill",
      });
      const skillB = makeSkill({
        name: "skill-b",
        prompt: "Handle database migrations.",
        description: "Database skill",
      });
      const result = analyzer.detectConflicts([skillA, skillB]);
      expect(result).toEqual([]);
    });

    test("detects overlap between skills with shared capabilities", () => {
      const skillA = makeSkill({
        name: "reviewer-a",
        prompt: "Review code for quality.",
        description: "Code review tool",
      });
      const skillB = makeSkill({
        name: "reviewer-b",
        prompt: "Review code and test it.",
        description: "Review and test tool",
      });
      const result = analyzer.detectConflicts([skillA, skillB]);
      const overlaps = result.filter((c) => c.type === "overlap");
      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].description).toContain("code review");
    });

    test("detects contradictions between conflicting skills", () => {
      const result = analyzer.detectConflicts([tsSkill, jsSkill]);
      const contradictions = result.filter((c) => c.type === "contradiction");
      expect(contradictions.length).toBeGreaterThan(0);
    });

    test("contradiction has high severity", () => {
      const result = analyzer.detectConflicts([tsSkill, jsSkill]);
      const contradictions = result.filter((c) => c.type === "contradiction");
      for (const c of contradictions) {
        expect(c.severity).toBe("high");
      }
    });

    test("detects duplicate skills with identical prompts", () => {
      const prompt = "You review code. Find bugs. Check style.";
      const skillA = makeSkill({
        name: "code-reviewer",
        description: "Review code",
        prompt,
      });
      const skillB = makeSkill({
        name: "code-auditor",
        description: "Review code",
        prompt,
      });
      const result = analyzer.detectConflicts([skillA, skillB]);
      const dupes = result.filter((c) => c.type === "duplicate");
      expect(dupes.length).toBeGreaterThan(0);
      expect(dupes[0].severity).toBe("high");
    });

    test("detects duplicate skills with same capabilities and no deps", () => {
      const skillA = makeSkill({
        name: "test-helper-a",
        description: "Write test cases",
        prompt: "Write test cases for the codebase.",
      });
      const skillB = makeSkill({
        name: "test-helper-b",
        description: "Write test cases",
        prompt: "Write test cases for the codebase.",
      });
      const result = analyzer.detectConflicts([skillA, skillB]);
      const dupes = result.filter((c) => c.type === "duplicate");
      expect(dupes.length).toBeGreaterThan(0);
    });

    test("overlap severity is high when 3+ shared capabilities", () => {
      const skillA = makeSkill({
        name: "full-a",
        prompt: "Review, test, debug, and optimize code.",
      });
      const skillB = makeSkill({
        name: "full-b",
        prompt: "Review, test, debug, and generate code.",
      });
      const result = analyzer.detectConflicts([skillA, skillB]);
      const overlaps = result.filter((c) => c.type === "overlap");
      if (overlaps.length > 0) {
        expect(overlaps[0].severity).toBe("high");
      }
    });

    test("conflict report has correct structure", () => {
      const result = analyzer.detectConflicts([tsSkill, jsSkill]);
      for (const c of result) {
        expect(c).toHaveProperty("skill");
        expect(c).toHaveProperty("type");
        expect(c).toHaveProperty("description");
        expect(c).toHaveProperty("severity");
        expect(["overlap", "contradiction", "duplicate"]).toContain(c.type);
        expect(["low", "medium", "high"]).toContain(c.severity);
      }
    });

    test("handles empty skills array", () => {
      const result = analyzer.detectConflicts([]);
      expect(result).toEqual([]);
    });

    test("skips self-comparison by name", () => {
      const skill = makeSkill({ name: "same-name" });
      const result = analyzer.detectConflicts([skill, skill]);
      expect(result).toEqual([]);
    });
  });
});
