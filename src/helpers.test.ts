import { describe, it, expect } from "bun:test";
import { getDefaultSkills, getDefaultPermission, buildSkillPromptEmbedding } from "./helpers.js";
import type { SkillDefinition } from "./types.js";

describe("getDefaultSkills", () => {
  const EXPECTED_DEFAULTS = [
    "caveman", "init", "memory", "evolution",
    "skill-combo", "subagent", "communicate", "auto-compact",
  ];

  it("returns default skills without additional", () => {
    const result = getDefaultSkills();
    expect(result).toEqual(EXPECTED_DEFAULTS);
  });

  it("returns default skills with additional skills", () => {
    const result = getDefaultSkills(["custom-skill", "another-skill"]);
    expect(result).toEqual([...EXPECTED_DEFAULTS, "custom-skill", "another-skill"]);
  });

  it("deduplicates when additional overlaps with defaults", () => {
    const result = getDefaultSkills(["caveman", "new-skill"]);
    expect(result).toEqual([...EXPECTED_DEFAULTS, "new-skill"]);
    // caveman should appear exactly once
    expect(result.filter((s) => s === "caveman")).toHaveLength(1);
  });

  it("returns a new array each call (not shared reference)", () => {
    const a = getDefaultSkills();
    const b = getDefaultSkills();
    expect(a).not.toBe(b);
    a.push("mutated");
    expect(b).not.toContain("mutated");
  });

  it("handles empty additional array", () => {
    const result = getDefaultSkills([]);
    expect(result).toEqual(EXPECTED_DEFAULTS);
  });
});

describe("getDefaultPermission", () => {
  it("returns correct permission object", () => {
    const perm = getDefaultPermission();
    expect(perm).toEqual({
      edit: "allow",
      bash: "allow",
      webfetch: "allow",
    });
  });

  it("returns a new object each call (deep copy)", () => {
    const a = getDefaultPermission();
    const b = getDefaultPermission();
    expect(a).not.toBe(b);
    (a as any).edit = "deny";
    expect(b.edit).toBe("allow");
  });
});

describe("buildSkillPromptEmbedding", () => {
  const mockSkills: SkillDefinition[] = [
    { name: "caveman", description: "Compressed comms", trigger: "always", prompt: "Be brief.", category: "builtin" },
    { name: "custom", description: "Custom skill", trigger: "on demand", prompt: "Do custom thing.", category: "user" },
  ];

  it("builds markdown sections for each skill", () => {
    const result = buildSkillPromptEmbedding(mockSkills);
    expect(result).toContain("## Skill: caveman\nBe brief.");
    expect(result).toContain("## Skill: custom\nDo custom thing.");
  });

  it("joins sections with double newline", () => {
    const result = buildSkillPromptEmbedding(mockSkills);
    expect(result).toContain("\n\n");
  });

  it("returns empty string for empty skills array", () => {
    const result = buildSkillPromptEmbedding([]);
    expect(result).toBe("");
  });

  it("matches exact output format: '## Skill: {name}\\n{prompt}'", () => {
    const single: SkillDefinition[] = [
      { name: "test", description: "d", trigger: "t", prompt: "Line1\nLine2", category: "builtin" },
    ];
    const result = buildSkillPromptEmbedding(single);
    expect(result).toBe("## Skill: test\nLine1\nLine2");
  });
});
