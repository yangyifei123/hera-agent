import { describe, it, expect, mock, beforeEach } from "bun:test";
import { DistillationEngine } from "./engine.js";
import type { MemoryStore } from "../memory/store.js";

function makeMockStore() {
  return {
    save: mock(async () => {}),
    delete: mock(async () => true),
    list: mock(async () => []),
    load: mock(async () => null),
    search: mock(async () => []),
  } as unknown as MemoryStore;
}

describe("DistillationEngine", () => {
  let engine: DistillationEngine;
  let store: MemoryStore;

  beforeEach(() => {
    store = makeMockStore();
    engine = new DistillationEngine(store);
  });

  describe("extractPatterns — Chinese tech keywords", () => {
    it("detects Chinese frontend patterns", async () => {
      const result = await engine.distillSession("test-cn-frontend", [
        { role: "user", content: "请用React框架开发一个响应式前端组件" },
        { role: "assistant", content: "好的，使用React和useEffect来实现响应式组件。" },
      ]);
      expect(result.patternsLearned).toContain("React");
      expect(result.patternsLearned).toContain("useEffect");
    });

    it("detects Chinese container/devops patterns", async () => {
      const result = await engine.distillSession("test-cn-devops", [
        { role: "user", content: "我们需要用Docker容器部署微服务到Kubernetes编排" },
        { role: "assistant", content: "好的，使用Docker容器和Kubernetes编排来部署微服务。" },
      ]);
      expect(result.patternsLearned).toContain("Docker");
      expect(result.patternsLearned).toContain("Kubernetes");
    });

    it("detects Chinese database patterns", async () => {
      const result = await engine.distillSession("test-cn-db", [
        { role: "user", content: "优化数据库查询，添加索引和Redis缓存" },
        { role: "assistant", content: "我将为数据库创建索引并配置Redis缓存来加速查询。" },
      ]);
      // Should have SQL or database-related patterns
      expect(result.patternsLearned.length).toBeGreaterThan(0);
    });

    it("detects Chinese auth patterns", async () => {
      const result = await engine.distillSession("test-cn-auth", [
        { role: "user", content: "实现认证鉴权系统，使用JWT令牌登录" },
        { role: "assistant", content: "设计基于JWT令牌的认证鉴权方案。" },
      ]);
      expect(result.patternsLearned).toContain("JWT");
    });

    it("detects Chinese testing patterns", async () => {
      const result = await engine.distillSession("test-cn-test", [
        { role: "user", content: "编写单元测试和集成测试，实现测试自动化" },
        { role: "assistant", content: "我将使用自动化单元测试和集成测试框架。" },
      ]);
      expect(result.patternsLearned.length).toBeGreaterThan(0);
    });
  });

  describe("extractPatterns — English (preserved)", () => {
    it("still detects English patterns", async () => {
      const result = await engine.distillSession("test-en", [
        { role: "user", content: "Build a React app with TypeScript and useMemo" },
        { role: "assistant", content: "Using React with TypeScript and the useMemo hook." },
      ]);
      expect(result.patternsLearned).toContain("React");
      expect(result.patternsLearned).toContain("TypeScript");
      expect(result.patternsLearned).toContain("useMemo");
    });
  });

  describe("extractArchitecturalDecisions", () => {
    it("detects Chinese architectural decisions", async () => {
      const result = await engine.distillSession("test-cn-decisions", [
        { role: "user", content: "我们应该使用微服务架构还是单体架构？" },
        { role: "assistant", content: "决定采用微服务架构，选择REST方案来实现服务间通信。" },
      ]);
      // Architectural decisions should be captured in keyDecisions
      expect(result.keyDecisions.length).toBeGreaterThan(0);
    });

    it("detects '选用' pattern", async () => {
      const result = await engine.distillSession("test-cn-select", [
        { role: "assistant", content: "选用PostgreSQL作为主数据库，决定采用读写分离方案。" },
      ]);
      expect(result.keyDecisions.length).toBeGreaterThan(0);
    });

    it("detects '使用X架构' pattern", async () => {
      const result = await engine.distillSession("test-cn-arch", [
        { role: "assistant", content: "使用分层架构来组织代码，确保关注点分离。" },
      ]);
      expect(result.keyDecisions.length).toBeGreaterThan(0);
    });
  });

  describe("generateSummary — bilingual", () => {
    it("handles Chinese content in summary", async () => {
      const result = await engine.distillSession("test-cn-summary", [
        { role: "user", content: "帮我实现用户登录功能" },
        {
          role: "assistant",
          content: "好的，我来实现基于JWT认证的用户登录功能，包含密码加密和令牌管理。",
        },
      ]);
      expect(result.summary).toBeTruthy();
      // Should contain Chinese characters
      expect(/[\u4e00-\u9fff]/.test(result.summary)).toBe(true);
    });

    it("handles mixed English and Chinese content", async () => {
      const result = await engine.distillSession("test-mixed", [
        { role: "user", content: "Implement React前端 with TypeScript" },
        {
          role: "assistant",
          content: "Using React组件 with TypeScript类型 for responsive响应式 design.",
        },
      ]);
      expect(result.summary).toBeTruthy();
    });

    it("truncates long summaries", async () => {
      const longContent = "A".repeat(500);
      const result = await engine.distillSession("test-long", [
        { role: "assistant", content: longContent },
      ]);
      // Summary should not exceed MAX_SUMMARY_LENGTH per segment
      expect(result.summary.length).toBeLessThan(1200); // 5 segments * ~200 + separators
    });
  });

  describe("distillSession — saves to store", () => {
    it("saves distillation result to memory store", async () => {
      await engine.distillSession("save-test", [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ]);
      expect(store.save).toHaveBeenCalledTimes(1);
      const savedArg = (store.save as any).mock.calls[0][0];
      expect(savedArg.id).toContain("distill-save-test");
      expect(savedArg.type).toBe("distillation");
    });
  });

  describe("distillToSkill", () => {
    it("creates a skill with user category", async () => {
      const distillResult = {
        summary: "Test summary",
        keyDecisions: ["decided to use X"],
        skillsExtracted: [],
        patternsLearned: ["React", "TypeScript"],
      };
      const skill = await engine.distillToSkill("test-skill", distillResult);
      expect(skill.name).toBe("test-skill");
      expect(skill.category).toBe("user");
      expect(skill.prompt).toContain("React");
      expect(skill.prompt).toContain("TypeScript");
    });
  });
});
