import { describe, it, expect } from "bun:test";
import { SkillAnalyzer, SkillDecomposer, CapabilityMapper } from "./analyzer.js";
import type { SkillDefinition } from "../types.js";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    description: "A generic helper",
    trigger: "assist",
    prompt: "You are a test skill.",
    category: "user",
    ...overrides,
  };
}

describe("SkillAnalyzer", () => {
  it("extracts coding capability from prompt keywords", () => {
    const skill = makeSkill({
      prompt: "You implement code and develop features.",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.capabilities.some((c) => c.name === "coding")).toBe(true);
  });

  it("extracts multiple capabilities", () => {
    const skill = makeSkill({
      prompt: "You write code, review it, and run tests to verify quality.",
    });
    const result = SkillAnalyzer.analyze(skill);
    const names = result.capabilities.map((c) => c.name);
    expect(names).toContain("coding");
    expect(names).toContain("review");
    expect(names).toContain("testing");
  });

  it("returns empty capabilities for generic prompt with no keyword matches", () => {
    const skill = makeSkill({
      prompt: "You help with daily tasks.",
      trigger: "help",
      description: "A generic helper",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.capabilities).toHaveLength(0);
  });

  it("assesses simple complexity for short prompt with few capabilities", () => {
    const skill = makeSkill({
      prompt: "Short prompt.",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.complexity).toBe("simple");
  });

  it("assesses complex complexity for long multi-step prompt with many capabilities and steps", () => {
    const skill = makeSkill({
      prompt: `Step 1: First analyze the requirements carefully.
Step 2: Then design the architecture for the system.
Step 3: Next implement the code to build the solution.
Step 4: After that write tests to verify and validate quality.
Step 5: Finally deploy the pipeline and release to production.
Step 6: Document all findings in the architecture docs.
Step 7: Optimize performance bottlenecks found during testing.
The workflow involves multiple phases and stages.
Iterate the loop until quality criteria are achieved.
Repeat this process for each feature branch. If conditions change, switch strategy.`,
      trigger: "develop",
      description: "Full lifecycle development agent",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.complexity).toBe("complex");
  });

  it("generates recommendations for well-scoped skill", () => {
    const skill = makeSkill({
      prompt: "Review code for correctness and style.",
      trigger: "review",
      description: "Code review helper",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("generates recommendation for no capabilities", () => {
    const skill = makeSkill({
      prompt: "Hello world.",
      trigger: "greet",
      description: "A greeting helper",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.recommendations.some((r) => r.includes("clear capabilities"))).toBe(true);
  });

  it("generates recommendation for many capabilities", () => {
    const skill = makeSkill({
      prompt: "You code, review, test, debug, document, optimize, research, design, and deploy.",
      trigger: "full-stack",
      description: "Full stack engineer",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(
      result.recommendations.some((r) => r.includes("concerns") || r.includes("Decomposition"))
    ).toBe(true);
  });

  it("generates recommendation for very short prompt", () => {
    const skill = makeSkill({
      prompt: "Hi.",
      trigger: "greet",
      description: "Greeting bot",
    });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.recommendations.some((r) => r.includes("short") || r.includes("expanding"))).toBe(
      true
    );
  });

  it("reports promptLength", () => {
    const skill = makeSkill({ prompt: "A".repeat(123) });
    const result = SkillAnalyzer.analyze(skill);
    expect(result.promptLength).toBe(123);
  });

  it("reports hasMultipleConcerns based on capability count > 2", () => {
    const single = makeSkill({
      prompt: "Check code quality and lint for errors.",
      trigger: "lint",
      description: "A linter helper",
    });
    // coding + review = 2 capabilities, not > 2
    expect(SkillAnalyzer.analyze(single).hasMultipleConcerns).toBe(false);

    const multi = makeSkill({
      prompt: "Write code, review it, and run tests for correctness and quality.",
      trigger: "develop",
      description: "Dev helper",
    });
    // coding + review + testing = 3 capabilities, > 2
    expect(SkillAnalyzer.analyze(multi).hasMultipleConcerns).toBe(true);
  });
});

describe("CapabilityMapper", () => {
  it("maps coding to all mode", () => {
    const mode = CapabilityMapper.mapToAgentMode([
      { name: "coding", confidence: 0.8, evidence: "code" },
    ]);
    expect(mode).toBe("all");
  });

  it("maps review to subagent mode when no autonomous capabilities", () => {
    const mode = CapabilityMapper.mapToAgentMode([
      { name: "review", confidence: 0.8, evidence: "review" },
    ]);
    expect(mode).toBe("subagent");
  });

  it("maps no capabilities to all mode (default)", () => {
    const mode = CapabilityMapper.mapToAgentMode([]);
    expect(mode).toBe("all");
  });

  it("maps simple complexity to 15 max steps", () => {
    expect(CapabilityMapper.mapToMaxSteps("simple")).toBe(15);
  });

  it("maps moderate complexity to 25 max steps", () => {
    expect(CapabilityMapper.mapToMaxSteps("moderate")).toBe(25);
  });

  it("maps complex complexity to 40 max steps", () => {
    expect(CapabilityMapper.mapToMaxSteps("complex")).toBe(40);
  });

  it("maps coding capability to edit + bash tools", () => {
    const tools = CapabilityMapper.mapToTools([
      { name: "coding", confidence: 0.8, evidence: "code" },
    ]);
    expect(tools.edit).toBe(true);
    expect(tools.bash).toBe(true);
  });

  it("maps research capability to webfetch", () => {
    const tools = CapabilityMapper.mapToTools([
      { name: "research", confidence: 0.8, evidence: "research" },
    ]);
    expect(tools.webfetch).toBe(true);
  });

  it("returns default tools when no capabilities match", () => {
    const tools = CapabilityMapper.mapToTools([{ name: "madeup", confidence: 0.5, evidence: "x" }]);
    expect(tools.edit).toBe(true);
    expect(tools.bash).toBe(true);
    expect(tools.webfetch).toBe(true);
  });

  it("mapToAgentCapabilities returns complete mapping", () => {
    const result = CapabilityMapper.mapToAgentCapabilities(
      [{ name: "coding", confidence: 0.9, evidence: "code" }],
      "simple"
    );
    expect(result.mode).toBe("all");
    expect(result.maxSteps).toBe(15);
    expect(result.tools.edit).toBe(true);
  });
});

describe("SkillDecomposer", () => {
  it("returns single skill for single detected capability", () => {
    // Only "security" capability detected — no other keywords match
    const skill = makeSkill({
      prompt: "Analyze for security vulnerabilities and OWASP compliance.",
      trigger: "scan",
      description: "Security scanner",
    });
    const result = SkillDecomposer.decompose(skill);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-skill");
  });

  it("splits multi-capability skill into sub-skills", () => {
    const skill = makeSkill({
      prompt:
        "## Code\nImplement features.\n\n## Test\nWrite test cases.\n\n## Review\nCheck code quality.",
      trigger: "develop",
      description: "Full dev skill",
    });
    const result = SkillDecomposer.decompose(skill);
    // Should produce sub-skills based on detected capabilities
    expect(result.length).toBeGreaterThan(1);
    const names = result.map((r) => r.name);
    expect(names.some((n) => n.includes("coding"))).toBe(true);
  });

  it("includes parent skill trigger in decomposed skills", () => {
    const skill = makeSkill({
      trigger: "code-review",
      description: "Code review helper",
      prompt: "Write code and review it for correctness and quality.",
    });
    const result = SkillDecomposer.decompose(skill);
    for (const sub of result) {
      expect(sub.trigger).toContain("code-review");
    }
  });

  it("handles empty prompt gracefully", () => {
    const skill = makeSkill({ prompt: "" });
    const result = SkillDecomposer.decompose(skill);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-skill");
  });
});
