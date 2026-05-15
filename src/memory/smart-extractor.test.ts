import { describe, test, expect } from "bun:test";
import { extractMemories, type ExtractedMemory } from "./smart-extractor.js";

describe("extractMemories", () => {
  describe("decision extraction", () => {
    test("extracts English decision pattern", () => {
      const messages = [
        { role: "user", content: "How should I implement auth?" },
        { role: "assistant", content: "I decided to use JWT for authentication." },
      ];
      const result = extractMemories(messages);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].category).toBe("decision");
      expect(result[0].content).toContain("use JWT for authentication");
    });

    test("extracts 'chose' pattern", () => {
      const messages = [
        { role: "assistant", content: "I chose React over Vue for this project." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.content.includes("React over Vue"))).toBe(true);
    });

    test("extracts 'will use' pattern", () => {
      const messages = [
        { role: "assistant", content: "We will use TypeScript for type safety." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.content.includes("TypeScript"))).toBe(true);
    });

    test("extracts Chinese decision pattern (选择)", () => {
      const messages = [
        { role: "assistant", content: "我选择使用Redis作为缓存方案。" },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.content.includes("Redis"))).toBe(true);
    });

    test("extracts Chinese decision pattern (决定采用)", () => {
      const messages = [
        { role: "assistant", content: "团队决定采用微服务架构。" },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.content.includes("微服务"))).toBe(true);
    });

    test("extracts 'should use' pattern", () => {
      const messages = [
        { role: "assistant", content: "You should use parameterized queries." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.content.includes("parameterized queries"))).toBe(true);
    });
  });

  describe("fix extraction", () => {
    test("extracts 'fixed' pattern", () => {
      const messages = [
        { role: "assistant", content: "I fixed the null pointer exception." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "fix")).toBe(true);
      expect(result.some((m) => m.content.includes("null pointer exception"))).toBe(true);
    });

    test("extracts 'resolved' pattern", () => {
      const messages = [
        { role: "assistant", content: "We resolved the memory leak issue." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "fix")).toBe(true);
    });

    test("extracts Chinese '修复了' pattern", () => {
      const messages = [
        { role: "assistant", content: "修复了登录页面的样式问题。" },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "fix")).toBe(true);
      expect(result.some((m) => m.content.includes("登录"))).toBe(true);
    });

    test("extracts Chinese '解决了' pattern", () => {
      const messages = [
        { role: "assistant", content: "解决了数据库连接超时问题。" },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "fix")).toBe(true);
    });
  });

  describe("pattern extraction", () => {
    test("extracts 'always use' pattern", () => {
      const messages = [
        { role: "assistant", content: "Always use async/await for async operations." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "pattern")).toBe(true);
    });

    test("extracts 'never do' pattern", () => {
      const messages = [
        { role: "assistant", content: "Never do string concatenation in loops." },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "pattern")).toBe(true);
    });

    test("extracts Chinese '必须' pattern", () => {
      const messages = [
        { role: "assistant", content: "必须对所有用户输入进行验证。" },
      ];
      const result = extractMemories(messages);
      expect(result.some((m) => m.category === "pattern")).toBe(true);
    });
  });

  describe("deduplication", () => {
    test("deduplicates exact duplicates", () => {
      const messages = [
        { role: "assistant", content: "I decided to use JWT. Also I decided to use JWT." },
      ];
      const result = extractMemories(messages);
      const decisionMemories = result.filter((m) => m.category === "decision");
      // Both matches produce same content, should be deduplicated
      expect(new Set(decisionMemories.map((m) => m.content.toLowerCase())).size).toBe(
        decisionMemories.length
      );
    });

    test("case-insensitive deduplication", () => {
      const messages = [
        { role: "assistant", content: "I decided to Use JWT." },
        { role: "assistant", content: "I decided to use jwt." },
      ];
      const result = extractMemories(messages);
      const jwtMemories = result.filter((m) => m.content.toLowerCase().includes("jwt"));
      // Should dedupe case-insensitively
      expect(jwtMemories.length).toBeLessThanOrEqual(1);
    });
  });

  describe("limits", () => {
    test("returns max 5 memories", () => {
      const messages = [
        { role: "assistant", content: "I decided to use option 1. I chose option 2. I fixed bug 3. I resolved issue 4. Always use pattern 5. Never do pattern 6." },
      ];
      const result = extractMemories(messages);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    test("rejects too short matches", () => {
      const messages = [
        { role: "assistant", content: "I decided to a." }, // "to a" is too short
      ];
      const result = extractMemories(messages);
      expect(result.length).toBe(0);
    });

    test("rejects too long matches", () => {
      const longContent = "x".repeat(250);
      const messages = [
        { role: "assistant", content: `I decided to ${longContent}.` },
      ];
      const result = extractMemories(messages);
      expect(result.length).toBe(0);
    });
  });

  describe("edge cases", () => {
    test("empty messages array returns empty", () => {
      const result = extractMemories([]);
      expect(result).toEqual([]);
    });

    test("no patterns found returns empty", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];
      const result = extractMemories(messages);
      expect(result).toEqual([]);
    });

    test("confidence values are in range", () => {
      const messages = [
        { role: "assistant", content: "I fixed the bug. I decided to use X." },
      ];
      const result = extractMemories(messages);
      for (const m of result) {
        expect(m.confidence).toBeGreaterThanOrEqual(0);
        expect(m.confidence).toBeLessThanOrEqual(1);
      }
    });

    test("fix has highest confidence", () => {
      const messages = [
        { role: "assistant", content: "I fixed the critical bug. I decided to refactor. Always use tests." },
      ];
      const result = extractMemories(messages);
      const fix = result.find((m) => m.category === "fix");
      const decision = result.find((m) => m.category === "decision");
      const pattern = result.find((m) => m.category === "pattern");
      
      if (fix && decision) {
        expect(fix.confidence).toBeGreaterThan(decision.confidence);
      }
      if (decision && pattern) {
        expect(decision.confidence).toBeGreaterThan(pattern.confidence);
      }
    });
  });

  describe("mixed content", () => {
    test("extracts multiple categories from single message", () => {
      const messages = [
        {
          role: "assistant",
          content: "I decided to use PostgreSQL. I fixed the connection timeout. Always use connection pooling.",
        },
      ];
      const result = extractMemories(messages);
      const categories = new Set(result.map((m) => m.category));
      expect(categories.size).toBeGreaterThan(1);
    });
  });
});