import { describe, it, expect } from "bun:test";
import { AUTO_COMPACT_SKILL, getAutoCompactPrompt } from "./auto-compact.js";

describe("AUTO_COMPACT_SKILL", () => {
  it("should export a SkillDefinition with correct identity", () => {
    expect(AUTO_COMPACT_SKILL.name).toBe("auto-compact");
    expect(AUTO_COMPACT_SKILL.category).toBe("builtin");
    expect(AUTO_COMPACT_SKILL.description).toBeTruthy();
    expect(AUTO_COMPACT_SKILL.trigger).toBeTruthy();
    expect(AUTO_COMPACT_SKILL.prompt).toBeTruthy();
  });

  it("prompt should teach context window discipline", () => {
    const p = AUTO_COMPACT_SKILL.prompt;
    expect(p.toLowerCase()).toContain("compact");
    // Must reference the memory tool so durable facts survive.
    expect(p).toContain("hera_remember");
  });

  it("getAutoCompactPrompt returns the same content", () => {
    expect(getAutoCompactPrompt()).toBe(AUTO_COMPACT_SKILL.prompt);
  });
});
