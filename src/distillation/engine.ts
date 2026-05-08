// Session Distillation - Extract skills, patterns, and key decisions from conversations

import type { DistillationResult, SkillDefinition } from "../types.js";
import type { MemoryStore } from "../memory/store.js";

export class DistillationEngine {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Distill a conversation session into structured knowledge
   */
  async distillSession(
    sessionId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<DistillationResult> {
    const result: DistillationResult = {
      summary: "",
      keyDecisions: [],
      skillsExtracted: [],
      patternsLearned: [],
    };

    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    result.summary = this.generateSummary(conversationText);
    result.keyDecisions = this.extractDecisions(conversationText);
    result.patternsLearned = this.extractPatterns(conversationText);

    await this.store.save({
      id: `distill-${sessionId}-${Date.now()}`,
      type: "distillation",
      content: JSON.stringify(result),
      timestamp: Date.now(),
      metadata: { sessionId, messageCount: messages.length },
    });

    return result;
  }

  /**
   * Convert distilled knowledge into a usable skill
   */
  async distillToSkill(
    name: string,
    distillation: DistillationResult
  ): Promise<SkillDefinition> {
    const skill: SkillDefinition = {
      name,
      description: `Auto-generated skill from session distillation: ${distillation.summary.slice(0, 100)}`,
      trigger: `When task involves: ${distillation.patternsLearned.join(", ")}`,
      prompt: this.buildSkillPrompt(distillation),
    };

    await this.store.save({
      id: `skill-${name}`,
      type: "skill",
      content: JSON.stringify(skill),
      timestamp: Date.now(),
      metadata: { source: "distillation", patterns: distillation.patternsLearned },
    });

    return skill;
  }

  private generateSummary(text: string): string {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= 3) return lines.join(" ");

    const assistantLines = lines.filter((l) => l.startsWith("assistant:"));
    const keyPoints = assistantLines.slice(0, 5).map((l) => {
      const content = l.replace(/^assistant:\s*/, "");
      return content.length > 200 ? content.slice(0, 200) + "..." : content;
    });

    return keyPoints.join(" | ");
  }

  private extractDecisions(text: string): string[] {
    const decisions: string[] = [];
    const patterns = [
      /(?:decided|decision|chose|chosen|selected|went with|resolved to)\s+(.+?)(?:\.|$)/gi,
      /(?:should|must|need to|will)\s+(?:use|implement|apply|follow)\s+(.+?)(?:\.|$)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && match[1].length > 5 && match[1].length < 200) {
          decisions.push(match[1].trim());
        }
      }
    }

    return [...new Set(decisions)].slice(0, 10);
  }

  private extractPatterns(text: string): string[] {
    const patterns: string[] = [];
    const techPatterns = [
      /\b(useMemo|useEffect|useState|useCallback)\b/g,
      /\b(React|Vue|Angular|Svelte)\b/g,
      /\b(TypeScript|JavaScript|Python|Go|Rust)\b/g,
      /\b(Docker|Kubernetes|AWS|GCP)\b/g,
      /\b(REST|GraphQL|gRPC|WebSocket)\b/g,
      /\b(SQL|NoSQL|Redis|MongoDB)\b/g,
      /\b(testing|TDD|BDD|CI\/CD)\b/g,
      /\b(auth|JWT|OAuth|session)\b/g,
    ];

    for (const p of techPatterns) {
      const matches = text.match(p);
      if (matches) {
        patterns.push(...new Set(matches));
      }
    }

    return [...new Set(patterns)].slice(0, 20);
  }

  private buildSkillPrompt(distillation: DistillationResult): string {
    return [
      `# Skill: Auto-distilled Knowledge`,
      ``,
      `## Summary`,
      distillation.summary,
      ``,
      `## Key Patterns`,
      ...distillation.patternsLearned.map((p) => `- ${p}`),
      ``,
      `## Key Decisions`,
      ...distillation.keyDecisions.map((d) => `- ${d}`),
    ].join("\n");
  }
}
