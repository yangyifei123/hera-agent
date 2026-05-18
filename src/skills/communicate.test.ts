import { describe, it, expect } from "bun:test";
import { COMMUNICATE_SKILL, getCommunicatePrompt } from "./communicate.js";

describe("COMMUNICATE_SKILL", () => {
  it("should export a SkillDefinition with correct identity", () => {
    expect(COMMUNICATE_SKILL.name).toBe("communicate");
    expect(COMMUNICATE_SKILL.category).toBe("builtin");
    expect(COMMUNICATE_SKILL.description).toBeTruthy();
    expect(COMMUNICATE_SKILL.trigger).toBeTruthy();
    expect(COMMUNICATE_SKILL.prompt).toBeTruthy();
  });

  it("prompt should teach inter-agent team messaging", () => {
    const p = COMMUNICATE_SKILL.prompt;
    expect(p).toContain("hera_team_message");
    // Should mention message kinds the team manager understands.
    expect(p.toLowerCase()).toContain("task");
    expect(p.toLowerCase()).toContain("result");
  });

  it("getCommunicatePrompt returns the same content", () => {
    expect(getCommunicatePrompt()).toBe(COMMUNICATE_SKILL.prompt);
  });
});
