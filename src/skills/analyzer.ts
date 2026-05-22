/**
 * Hera Skill Analyzer Module
 * Intelligent skill analysis, decomposition, and capability mapping.
 * Powers the hera_upgrade_to_agent enhancement and new analysis tools.
 */

import type { SkillDefinition, AgentMode } from "../types.js";

// --- Analysis Types ---

export type ComplexityLevel = "simple" | "moderate" | "complex";

export interface Capability {
  name: string;
  confidence: number; // 0-1
  evidence: string;
}

export interface AnalysisResult {
  skillName: string;
  capabilities: Capability[];
  complexity: ComplexityLevel;
  promptLength: number;
  hasMultipleConcerns: boolean;
  recommendations: string[];
  suggestedMode: AgentMode;
  suggestedMaxSteps: number;
}

export interface DecomposedSkill {
  name: string;
  description: string;
  prompt: string;
  trigger: string;
}

// --- SkillAnalyzer ---

/**
 * Analyzes a skill's capabilities, complexity, and provides recommendations.
 */
export class SkillAnalyzer {
  /**
   * Analyze a single skill and return structured analysis results.
   */
  static analyze(skill: SkillDefinition): AnalysisResult {
    const capabilities = SkillAnalyzer.extractCapabilities(skill);
    const complexity = SkillAnalyzer.assessComplexity(skill, capabilities);
    const recommendations = SkillAnalyzer.generateRecommendations(skill, complexity, capabilities);

    return {
      skillName: skill.name,
      capabilities,
      complexity,
      promptLength: skill.prompt.length,
      hasMultipleConcerns: capabilities.length > 2,
      recommendations,
      suggestedMode: CapabilityMapper.mapToAgentMode(capabilities),
      suggestedMaxSteps: CapabilityMapper.mapToMaxSteps(complexity),
    };
  }

  /**
   * Extract capabilities from skill prompt, description, and trigger.
   */
  static extractCapabilities(skill: SkillDefinition): Capability[] {
    const capabilities: Capability[] = [];
    const text = `${skill.prompt} ${skill.description} ${skill.trigger}`.toLowerCase();

    const patterns: Array<{ keywords: string[]; name: string }> = [
      {
        keywords: ["code", "implement", "develop", "program", "build", "write code"],
        name: "coding",
      },
      { keywords: ["review", "audit", "check", "inspect", "lint"], name: "review" },
      { keywords: ["test", "verify", "validate", "qa", "assert"], name: "testing" },
      { keywords: ["debug", "fix", "diagnose", "troubleshoot", "trace"], name: "debugging" },
      { keywords: ["document", "explain", "describe", "readme", "docs"], name: "documentation" },
      {
        keywords: ["optimize", "performance", "speed", "refactor", "improve"],
        name: "optimization",
      },
      { keywords: ["research", "investigate", "find", "search", "analyze data"], name: "research" },
      { keywords: ["design", "architect", "plan", "structure", "model"], name: "architecture" },
      { keywords: ["deploy", "release", "ci/cd", "pipeline", "publish"], name: "deployment" },
      { keywords: ["security", "vulnerability", "owasp", "auth", "encrypt"], name: "security" },
    ];

    for (const pattern of patterns) {
      const matches = pattern.keywords.filter((kw) => text.includes(kw));
      if (matches.length > 0) {
        capabilities.push({
          name: pattern.name,
          confidence: Math.min(matches.length / pattern.keywords.length + 0.3, 1),
          evidence: matches.join(", "),
        });
      }
    }

    return capabilities;
  }

  /**
   * Assess overall complexity of a skill.
   */
  private static assessComplexity(
    skill: SkillDefinition,
    capabilities: Capability[]
  ): ComplexityLevel {
    let score = 0;

    // Prompt length contributes
    if (skill.prompt.length > 2000) score += 2;
    else if (skill.prompt.length > 500) score += 1;

    // Number of capabilities
    if (capabilities.length > 4) score += 2;
    else if (capabilities.length > 2) score += 1;

    // Check for multi-step indicators
    const multiStepIndicators = [
      "step",
      "first",
      "then",
      "next",
      "after",
      "finally",
      "phase",
      "stage",
      "iterate",
      "loop",
      "repeat",
      "pipeline",
      "workflow",
      "sequence",
    ];
    const lowerPrompt = skill.prompt.toLowerCase();
    const stepMatches = multiStepIndicators.filter((ind) => lowerPrompt.includes(ind));
    if (stepMatches.length > 3) score += 2;
    else if (stepMatches.length > 0) score += 1;

    // Check for conditional logic
    const conditionalIndicators = ["if", "when", "unless", "condition", "switch", "branch"];
    const condMatches = conditionalIndicators.filter((c) => lowerPrompt.includes(c));
    if (condMatches.length > 2) score += 1;

    if (score >= 5) return "complex";
    if (score >= 3) return "moderate";
    return "simple";
  }

  /**
   * Generate actionable recommendations based on analysis.
   */
  private static generateRecommendations(
    skill: SkillDefinition,
    complexity: ComplexityLevel,
    capabilities: Capability[]
  ): string[] {
    const recs: string[] = [];

    if (complexity === "complex") {
      recs.push("Consider decomposing into smaller, focused skills for maintainability.");
    }

    if (capabilities.length === 0) {
      recs.push(
        "No clear capabilities detected. Consider adding more specific instructions to the prompt."
      );
    }

    if (capabilities.length > 4) {
      recs.push(
        "Skill covers many concerns. Decomposition recommended for cleaner agent behavior."
      );
    }

    const highConfidence = capabilities.filter((c) => c.confidence >= 0.7);
    if (highConfidence.length > 0) {
      const names = highConfidence.map((c) => c.name).join(", ");
      recs.push(`Primary strengths: ${names}.`);
    }

    if (skill.prompt.length < 100) {
      recs.push("Prompt is very short. Consider expanding with more detailed instructions.");
    }

    if (recs.length === 0) {
      recs.push("Skill appears well-scoped for upgrade to agent.");
    }

    return recs;
  }
}

// --- SkillDecomposer ---

/**
 * Decomposes a complex skill into smaller, atomic skill packages.
 */
export class SkillDecomposer {
  /**
   * Decompose a skill into atomic sub-skills based on capability boundaries.
   */
  static decompose(skill: SkillDefinition): DecomposedSkill[] {
    const capabilities = SkillAnalyzer.extractCapabilities(skill);
    const result: DecomposedSkill[] = [];

    if (capabilities.length <= 1) {
      // Skill is already atomic — return as-is with cleaned name
      result.push({
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt,
        trigger: skill.trigger,
      });
      return result;
    }

    // Split prompt by headings or sections
    const sections = SkillDecomposer.splitPromptIntoSections(skill.prompt);

    for (const cap of capabilities) {
      const matchingSection = sections.find(
        (s) =>
          s.toLowerCase().includes(cap.name) ||
          s.toLowerCase().includes(cap.evidence.split(", ")[0])
      );

      result.push({
        name: `${skill.name}-${cap.name}`,
        description: `${cap.name} capability extracted from ${skill.name}`,
        prompt: matchingSection || SkillDecomposer.generateCapabilityPrompt(skill, cap),
        trigger: `${cap.name}, ${skill.trigger}`,
      });
    }

    return result;
  }

  /**
   * Attempt to split a prompt into sections by markdown headings.
   */
  private static splitPromptIntoSections(prompt: string): string[] {
    // Split by ## headings first, then by ## or paragraphs
    const sections = prompt.split(/^##\s+/m).filter(Boolean);
    if (sections.length > 1) return sections;

    // Fallback: split by double newlines
    return prompt.split(/\n\n+/).filter((s) => s.trim().length > 0);
  }

  /**
   * Generate a focused prompt for a single capability.
   */
  private static generateCapabilityPrompt(skill: SkillDefinition, cap: Capability): string {
    return [
      `# ${cap.name}`,
      ``,
      `Extracted from parent skill: ${skill.name}`,
      ``,
      `You specialize in: ${cap.name}.`,
      `Evidence keywords: ${cap.evidence}.`,
      ``,
      `Original skill context:`,
      skill.prompt.slice(0, 500),
      cap.confidence < 0.7
        ? "\nNote: This capability had low detection confidence. Verify relevance."
        : "",
    ].join("\n");
  }
}

// --- CapabilityMapper ---

/**
 * Maps skill capabilities to agent configuration parameters.
 */
export class CapabilityMapper {
  /**
   * Determine the best agent mode based on capabilities.
   */
  static mapToAgentMode(capabilities: Capability[]): AgentMode {
    const names = capabilities.map((c) => c.name);

    // Autonomous tasks need "all" or "primary"
    const autonomousCapabilities = ["coding", "architecture", "debugging", "research"];
    if (names.some((n) => autonomousCapabilities.includes(n))) {
      return "all";
    }

    // Review/testing/optimization are typically subagent tasks
    const subagentCapabilities = ["review", "testing", "documentation", "optimization", "security"];
    const subagentCount = names.filter((n) => subagentCapabilities.includes(n)).length;
    if (subagentCount > 0 && !names.some((n) => autonomousCapabilities.includes(n))) {
      return "subagent";
    }

    return "all";
  }

  /**
   * Determine appropriate max steps based on complexity.
   */
  static mapToMaxSteps(complexity: ComplexityLevel): number {
    switch (complexity) {
      case "simple":
        return 15;
      case "moderate":
        return 25;
      case "complex":
        return 40;
    }
  }

  /**
   * Determine suggested tools based on capabilities.
   */
  static mapToTools(capabilities: Capability[]): Record<string, boolean> {
    const tools: Record<string, boolean> = {};
    const names = capabilities.map((c) => c.name);

    if (names.includes("coding") || names.includes("debugging")) {
      tools.edit = true;
      tools.bash = true;
    }

    if (names.includes("research")) {
      tools.webfetch = true;
    }

    if (names.includes("review") || names.includes("security")) {
      tools.edit = true; // read-only review may still need to reference files
    }

    if (names.includes("deployment")) {
      tools.bash = true;
    }

    // Default: if no specific tools matched, enable all basics
    if (Object.keys(tools).length === 0) {
      tools.edit = true;
      tools.bash = true;
      tools.webfetch = true;
    }

    return tools;
  }

  /**
   * Full capability mapping: returns mode, tools, and maxSteps together.
   */
  static mapToAgentCapabilities(
    capabilities: Capability[],
    complexity: ComplexityLevel
  ): {
    mode: AgentMode;
    tools: Record<string, boolean>;
    maxSteps: number;
  } {
    return {
      mode: CapabilityMapper.mapToAgentMode(capabilities),
      tools: CapabilityMapper.mapToTools(capabilities),
      maxSteps: CapabilityMapper.mapToMaxSteps(complexity),
    };
  }
}
