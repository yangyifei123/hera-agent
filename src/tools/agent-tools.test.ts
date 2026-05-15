import { describe, it, expect } from "bun:test";
import { suggestTemplate, suggestMode, slugifyName, findAvailableName } from "../tools/agent-tools.js";

describe("suggestTemplate", () => {
  it("maps code/program/develop keywords to coder", () => {
    expect(suggestTemplate("I need an agent to write code")).toBe("coder");
    expect(suggestTemplate("Build a program for data processing")).toBe("coder");
    expect(suggestTemplate("Develop new features")).toBe("coder");
  });

  it("maps review/audit/check to reviewer", () => {
    expect(suggestTemplate("Review my code for bugs")).toBe("reviewer");
    expect(suggestTemplate("Audit security of the project")).toBe("reviewer");
    expect(suggestTemplate("Check code quality")).toBe("reviewer");
  });

  it("maps research/investigate/find to researcher", () => {
    expect(suggestTemplate("Research best practices for REST APIs")).toBe("researcher");
    expect(suggestTemplate("Investigate the root cause of the crash")).toBe("researcher");
    expect(suggestTemplate("Find solutions for caching strategies")).toBe("researcher");
  });

  it("maps test/QA/quality to tester", () => {
    expect(suggestTemplate("Write test cases for the module")).toBe("tester");
    expect(suggestTemplate("QA the new feature")).toBe("tester");
    expect(suggestTemplate("Ensure quality of the release")).toBe("tester");
  });

  it("maps document/write/explain to documenter", () => {
    expect(suggestTemplate("Document the API endpoints")).toBe("documenter");
    expect(suggestTemplate("Write README for the project")).toBe("documenter");
    expect(suggestTemplate("Explain the architecture")).toBe("documenter");
  });

  it("maps optimize/performance/speed to optimizer", () => {
    expect(suggestTemplate("Optimize database queries")).toBe("optimizer");
    expect(suggestTemplate("Improve performance of the service")).toBe("optimizer");
    expect(suggestTemplate("Speed up request handling")).toBe("optimizer");
  });

  it("maps debug/fix/troubleshoot to debugger", () => {
    expect(suggestTemplate("Debug the memory leak issue")).toBe("debugger");
    expect(suggestTemplate("Fix the broken authentication flow")).toBe("debugger");
    expect(suggestTemplate("Troubleshoot the connection timeout")).toBe("debugger");
  });

  it("maps design/architecture/plan to architect", () => {
    expect(suggestTemplate("Design the microservices architecture")).toBe("architect");
    expect(suggestTemplate("Plan the system migration")).toBe("architect");
  });

  it("maps coordinate/manage/organize to coordinator", () => {
    expect(suggestTemplate("Coordinate the team workflow")).toBe("coordinator");
    expect(suggestTemplate("Manage the deployment pipeline")).toBe("coordinator");
    expect(suggestTemplate("Organize the project tasks")).toBe("coordinator");
  });

  it("defaults to general for unrecognized input", () => {
    expect(suggestTemplate("Help me with random stuff")).toBe("general");
    expect(suggestTemplate("")).toBe("general");
    expect(suggestTemplate("Do something cool")).toBe("general");
  });

  it("is case-insensitive", () => {
    expect(suggestTemplate("CODE the backend")).toBe("coder");
    expect(suggestTemplate("REVIEW the pull request")).toBe("reviewer");
    expect(suggestTemplate("Test the feature")).toBe("tester");
  });
});

describe("suggestMode", () => {
  it("subagent for reviewer, tester, documenter, optimizer", () => {
    expect(suggestMode("reviewer")).toBe("subagent");
    expect(suggestMode("tester")).toBe("subagent");
    expect(suggestMode("documenter")).toBe("subagent");
    expect(suggestMode("optimizer")).toBe("subagent");
  });

  it("all for coder, researcher, coordinator, architect, debugger, general", () => {
    expect(suggestMode("coder")).toBe("all");
    expect(suggestMode("researcher")).toBe("all");
    expect(suggestMode("coordinator")).toBe("all");
    expect(suggestMode("architect")).toBe("all");
    expect(suggestMode("debugger")).toBe("all");
    expect(suggestMode("general")).toBe("all");
  });
});

describe("slugifyName", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyName("My Cool Agent")).toBe("my-cool-agent");
  });

  it("removes special characters", () => {
    expect(slugifyName("Agent@#$% Name!")).toBe("agent-name");
  });

  it("handles camelCase", () => {
    expect(slugifyName("codeReviewer")).toBe("code-reviewer");
  });

  it("collapses multiple hyphens", () => {
    expect(slugifyName("hello  world--test")).toBe("hello-world-test");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyName("--hello--")).toBe("hello");
  });

  it("ensures starts with letter", () => {
    expect(slugifyName("123-agent")).toBe("agent-123-agent");
  });

  it("handles empty input", () => {
    expect(slugifyName("")).toBe("agent");
  });

  it("handles purely special chars", () => {
    expect(slugifyName("@#$%")).toBe("agent");
  });
});

describe("findAvailableName", () => {
  it("returns original name if available", () => {
    const existing = new Map<string, unknown>();
    expect(findAvailableName("my-agent", existing)).toBe("my-agent");
  });

  it("appends number if name taken", () => {
    const existing = new Map<string, unknown>();
    existing.set("my-agent", {});
    expect(findAvailableName("my-agent", existing)).toBe("my-agent-2");
  });

  it("increments number until available", () => {
    const existing = new Map<string, unknown>();
    existing.set("my-agent", {});
    existing.set("my-agent-2", {});
    existing.set("my-agent-3", {});
    expect(findAvailableName("my-agent", existing)).toBe("my-agent-4");
  });
});
