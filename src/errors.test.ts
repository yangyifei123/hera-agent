import { describe, test, expect } from "bun:test";
import {
  HeraError,
  AgentError,
  SkillError,
  TeamError,
  MemoryError,
  ErrorCode,
  isHeraError,
  wrapError,
  formatErrorMessage,
} from "./errors.js";

describe("HeraError", () => {
  test("creates error with code and message", () => {
    const error = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Agent 'test' not found");
    expect(error.code).toBe(ErrorCode.AGENT_NOT_FOUND);
    expect(error.message).toBe("Agent 'test' not found");
    expect(error.name).toBe("HeraError");
  });

  test("includes details", () => {
    const error = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Not found", { agentName: "test" });
    expect(error.details).toEqual({ agentName: "test" });
  });

  test("serializes to JSON", () => {
    const error = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Not found", { agentName: "test" });
    const json = error.toJSON();
    expect(json.name).toBe("HeraError");
    expect(json.code).toBe(ErrorCode.AGENT_NOT_FOUND);
    expect(json.message).toBe("Not found");
    expect(json.details).toEqual({ agentName: "test" });
  });
});

describe("Specialized error types", () => {
  test("AgentError", () => {
    const error = new AgentError(ErrorCode.AGENT_NOT_FOUND, "Agent not found");
    expect(error.name).toBe("AgentError");
    expect(error instanceof HeraError).toBe(true);
  });

  test("SkillError", () => {
    const error = new SkillError(ErrorCode.SKILL_NOT_FOUND, "Skill not found");
    expect(error.name).toBe("SkillError");
    expect(error instanceof HeraError).toBe(true);
  });

  test("TeamError", () => {
    const error = new TeamError(ErrorCode.TEAM_NOT_FOUND, "Team not found");
    expect(error.name).toBe("TeamError");
    expect(error instanceof HeraError).toBe(true);
  });

  test("MemoryError", () => {
    const error = new MemoryError(ErrorCode.MEMORY_NOT_FOUND, "Memory not found");
    expect(error.name).toBe("MemoryError");
    expect(error instanceof HeraError).toBe(true);
  });
});

describe("isHeraError", () => {
  test("returns true for HeraError", () => {
    const error = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Not found");
    expect(isHeraError(error)).toBe(true);
  });

  test("returns true for specialized errors", () => {
    const error = new AgentError(ErrorCode.AGENT_NOT_FOUND, "Not found");
    expect(isHeraError(error)).toBe(true);
  });

  test("returns false for standard Error", () => {
    const error = new Error("Standard error");
    expect(isHeraError(error)).toBe(false);
  });

  test("returns false for non-errors", () => {
    expect(isHeraError("string")).toBe(false);
    expect(isHeraError(null)).toBe(false);
    expect(isHeraError(undefined)).toBe(false);
  });
});

describe("wrapError", () => {
  test("returns HeraError unchanged", () => {
    const original = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Not found");
    const wrapped = wrapError(original, ErrorCode.AGENT_CREATION_FAILED);
    expect(wrapped).toBe(original);
  });

  test("wraps standard Error", () => {
    const original = new Error("Standard error");
    const wrapped = wrapError(original, ErrorCode.AGENT_CREATION_FAILED);
    expect(wrapped.code).toBe(ErrorCode.AGENT_CREATION_FAILED);
    expect(wrapped.message).toBe("Standard error");
    expect(wrapped.details?.originalError).toBeDefined();
  });

  test("wraps with context", () => {
    const original = new Error("File not found");
    const wrapped = wrapError(original, ErrorCode.FS_READ_FAILED, "Reading agent config");
    expect(wrapped.message).toBe("Reading agent config: File not found");
  });

  test("wraps non-Error values", () => {
    const wrapped = wrapError("string error", ErrorCode.VALIDATION_FAILED);
    expect(wrapped.message).toBe("string error");
    expect(wrapped.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

describe("formatErrorMessage", () => {
  test("formats error without details", () => {
    const error = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Agent not found");
    const formatted = formatErrorMessage(error);
    expect(formatted).toBe("[HeraError] Agent not found");
  });

  test("formats error with details", () => {
    const error = new HeraError(ErrorCode.AGENT_NOT_FOUND, "Agent not found", {
      agentName: "test",
    });
    const formatted = formatErrorMessage(error);
    expect(formatted).toContain("[HeraError] Agent not found");
    expect(formatted).toContain("Details:");
    expect(formatted).toContain("agentName");
  });

  test("formats specialized error", () => {
    const error = new AgentError(ErrorCode.AGENT_NOT_FOUND, "Not found", { name: "test" });
    const formatted = formatErrorMessage(error);
    expect(formatted).toContain("[AgentError] Not found");
  });
});
