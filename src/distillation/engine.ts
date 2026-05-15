// Session Distillation - Extract skills, patterns, and key decisions from conversations

import type { DistillationResult, SkillDefinition } from "../types.js";
import type { MemoryStore } from "../memory/store.js";
import {
  MAX_DISTILL_DECISIONS,
  MAX_DISTILL_PATTERNS,
  MAX_SUMMARY_LENGTH,
  MAX_SKILL_DESC_LENGTH,
} from "../constants.js";

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
      description: `Auto-generated skill from session distillation: ${distillation.summary.slice(0, MAX_SKILL_DESC_LENGTH)}`,
      trigger: `When task involves: ${distillation.patternsLearned.join(", ")}`,
      prompt: this.buildSkillPrompt(distillation),
      category: "user",
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
      return content.length > MAX_SUMMARY_LENGTH ? content.slice(0, MAX_SUMMARY_LENGTH) + "..." : content;
    });

    return keyPoints.join(" | ");
  }

  private extractDecisions(text: string): string[] {
    const decisions: string[] = [];
    const patterns = [
      // English decision patterns
      /(?:decided|decision|chose|chosen|selected|went with|resolved to)\s+(.+?)(?:\.|$)/gi,
      /(?:should|must|need to|will)\s+(?:use|implement|apply|follow)\s+(.+?)(?:\.|$)/gi,
      // Chinese architectural decision patterns
      /(?:决定采用|选用|选择|使用)\s*(.+?)(?:方案|架构|设计)?(?:[，。、；\n]|$)/g,
      /(?:使用)(.+?)(?:架构|方案|模式|框架)(?:[，。、；\n]|$)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && match[1].length > 2 && match[1].length < 200) {
          decisions.push(match[1].trim());
        }
      }
    }

    return [...new Set(decisions)].slice(0, MAX_DISTILL_DECISIONS);
  }

  private extractPatterns(text: string): string[] {
    const patterns: string[] = [];
    const techPatterns = [
      // English patterns
      /\b(useMemo|useEffect|useState|useCallback)\b/g,
      /\b(React|Vue|Angular|Svelte)\b/g,
      /\b(TypeScript|JavaScript|Python|Go|Rust)\b/g,
      /\b(Docker|Kubernetes|AWS|GCP)\b/g,
      /\b(REST|GraphQL|gRPC|WebSocket)\b/g,
      /\b(SQL|NoSQL|Redis|MongoDB)\b/g,
      /\b(testing|TDD|BDD|CI\/CD)\b/g,
      /\b(auth|JWT|OAuth|session)\b/g,
      // Chinese patterns (no \b — CJK chars don't have word boundaries)
      /前端|组件|响应式|框架/g,
      /容器|编排|部署|微服务/g,
      /数据库|查询|索引|缓存/g,
      /认证|鉴权|令牌|登录/g,
      /测试|单元测试|集成测试|自动化/g,
    ];

    for (const p of techPatterns) {
      const matches = text.match(p);
      if (matches) {
        patterns.push(...new Set(matches));
      }
    }

    return [...new Set(patterns)].slice(0, MAX_DISTILL_PATTERNS);
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
