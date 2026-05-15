import { describe, test, expect } from "bun:test";
import { validateAgentName, validateAgentNameWithConflict } from "./validation.js";

describe("validateAgentName", () => {
  describe("valid names", () => {
    test("simple lowercase name", () => {
      expect(validateAgentName("my-agent")).toEqual({ valid: true });
    });

    test("single letter", () => {
      expect(validateAgentName("a")).toEqual({ valid: true });
    });

    test("letters and numbers", () => {
      expect(validateAgentName("agent123")).toEqual({ valid: true });
    });

    test("hyphenated name", () => {
      expect(validateAgentName("my-cool-agent")).toEqual({ valid: true });
    });

    test("mixed letters numbers hyphens", () => {
      expect(validateAgentName("code-guardian-v2")).toEqual({ valid: true });
    });

    test("exactly 50 characters", () => {
      const name = "a" + "-".repeat(48) + "z";
      expect(name.length).toBe(50);
      expect(validateAgentName(name)).toEqual({ valid: true });
    });
  });

  describe("empty names", () => {
    test("empty string", () => {
      const result = validateAgentName("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("required");
    });

    test("whitespace-only is invalid (fails regex)", () => {
      const result = validateAgentName("   ");
      expect(result.valid).toBe(false);
    });
  });

  describe("too long names", () => {
    test("51 characters", () => {
      const name = "a".repeat(51);
      const result = validateAgentName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("50");
      expect(result.suggestion).toBe("a".repeat(50));
    });

    test("100 characters truncation", () => {
      const name = "agent-" + "x".repeat(94);
      const result = validateAgentName(name);
      expect(result.valid).toBe(false);
      expect(result.suggestion!.length).toBeLessThanOrEqual(50);
    });
  });

  describe("invalid characters", () => {
    test("uppercase letters", () => {
      const result = validateAgentName("MyAgent");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("lowercase");
      expect(result.suggestion).toBe("myagent");
    });

    test("spaces", () => {
      const result = validateAgentName("my agent");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("my-agent");
    });

    test("underscores", () => {
      const result = validateAgentName("my_agent");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("my-agent");
    });

    test("special characters", () => {
      const result = validateAgentName("my@agent!");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("my-agent");
    });

    test("starts with number", () => {
      const result = validateAgentName("123-agent");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("a123-agent");
    });

    test("starts with hyphen", () => {
      const result = validateAgentName("-agent");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("agent");
    });

    test("ends with hyphen", () => {
      const result = validateAgentName("agent-");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("agent");
    });

    test("consecutive hyphens in suggestion", () => {
      const result = validateAgentName("My Cool Agent");
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe("my-cool-agent");
    });

    test("unicode characters", () => {
      const result = validateAgentName("代理-agent");
      expect(result.valid).toBe(false);
    });
  });

  describe("reserved names", () => {
    test('"hera" is reserved', () => {
      const result = validateAgentName("hera");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
    });

    test('"opencode" is reserved', () => {
      const result = validateAgentName("opencode");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
    });

    test('"system" is reserved', () => {
      const result = validateAgentName("system");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
    });

    test("reserved names have no suggestion", () => {
      const result = validateAgentName("hera");
      expect(result.suggestion).toBeUndefined();
    });
  });
});

describe("validateAgentNameWithConflict", () => {
  const existing = new Set(["existing-agent", "old-coder"]);

  test("valid name with no conflict passes", () => {
    const result = validateAgentNameWithConflict("new-agent", existing);
    expect(result.valid).toBe(true);
  });

  test("conflicting name fails", () => {
    const result = validateAgentNameWithConflict("existing-agent", existing);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
    expect(result.error).toContain("hera_delete_agent");
  });

  test("invalid name fails before conflict check", () => {
    const result = validateAgentNameWithConflict("BAD NAME", existing);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("lowercase");
  });

  test("reserved name fails before conflict check", () => {
    const result = validateAgentNameWithConflict("hera", existing);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("reserved");
  });

  test("works with Map", () => {
    const existingMap = new Map([["mapped-agent", {}]]);
    const result = validateAgentNameWithConflict("mapped-agent", existingMap);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  test("empty Map allows new names", () => {
    const emptyMap = new Map<string, unknown>();
    const result = validateAgentNameWithConflict("fresh-agent", emptyMap);
    expect(result.valid).toBe(true);
  });
});