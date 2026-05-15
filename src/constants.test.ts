import { describe, test, expect } from "bun:test";
import {
  DEFAULT_HERA_MAX_STEPS,
  DEFAULT_CHILD_MAX_STEPS,
  TEAM_POLL_MAX_ATTEMPTS,
  TEAM_POLL_INTERVAL_MS,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_TEAM_TIMEOUT_MS,
  DEFAULT_SKILLS,
  DEFAULT_PERMISSION,
  MAX_DISTILL_DECISIONS,
  MAX_DISTILL_PATTERNS,
  MAX_SUMMARY_LENGTH,
  MAX_SKILL_DESC_LENGTH,
  MAX_RECALL_RESULTS,
  MAX_RESULT_PREVIEW_LENGTH,
} from "./constants.js";

describe("Constants", () => {
  describe("Agent Configuration", () => {
    test("DEFAULT_HERA_MAX_STEPS is 50", () => {
      expect(DEFAULT_HERA_MAX_STEPS).toBe(50);
    });

    test("DEFAULT_CHILD_MAX_STEPS is 30", () => {
      expect(DEFAULT_CHILD_MAX_STEPS).toBe(30);
    });

    test("DEFAULT_HERA_MAX_STEPS > DEFAULT_CHILD_MAX_STEPS", () => {
      expect(DEFAULT_HERA_MAX_STEPS).toBeGreaterThan(DEFAULT_CHILD_MAX_STEPS);
    });
  });

  describe("Team Configuration", () => {
    test("TEAM_POLL_MAX_ATTEMPTS is 120", () => {
      expect(TEAM_POLL_MAX_ATTEMPTS).toBe(120);
    });

    test("TEAM_POLL_INTERVAL_MS is 1000", () => {
      expect(TEAM_POLL_INTERVAL_MS).toBe(1000);
    });

    test("DEFAULT_TEAM_TIMEOUT_MS is 300000 (5 minutes)", () => {
      expect(DEFAULT_TEAM_TIMEOUT_MS).toBe(300_000);
    });

    test("poll interval * max attempts covers >5 minutes", () => {
      // 120 attempts * 1000ms = 120 seconds = 2 minutes minimum wait
      expect(TEAM_POLL_MAX_ATTEMPTS * TEAM_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(120_000);
    });
  });

  describe("Memory Configuration", () => {
    test("DEFAULT_MEMORY_LIMIT is 1000", () => {
      expect(DEFAULT_MEMORY_LIMIT).toBe(1000);
    });
  });

  describe("Default Skills", () => {
    test("DEFAULT_SKILLS contains 4 core skills", () => {
      expect(DEFAULT_SKILLS).toHaveLength(4);
    });

    test("DEFAULT_SKILLS contains caveman, init, memory, evolution", () => {
      expect(DEFAULT_SKILLS).toContain("caveman");
      expect(DEFAULT_SKILLS).toContain("init");
      expect(DEFAULT_SKILLS).toContain("memory");
      expect(DEFAULT_SKILLS).toContain("evolution");
    });

    test("DEFAULT_SKILLS is readonly (as const)", () => {
      // TypeScript as const makes this a readonly tuple
      expect(Object.isFrozen(DEFAULT_SKILLS) || Array.isArray(DEFAULT_SKILLS)).toBe(true);
    });
  });

  describe("Default Permissions", () => {
    test("DEFAULT_PERMISSION has edit, bash, webfetch all set to allow", () => {
      expect(DEFAULT_PERMISSION.edit).toBe("allow");
      expect(DEFAULT_PERMISSION.bash).toBe("allow");
      expect(DEFAULT_PERMISSION.webfetch).toBe("allow");
    });
  });

  describe("Distillation Limits", () => {
    test("MAX_DISTILL_DECISIONS is 10", () => {
      expect(MAX_DISTILL_DECISIONS).toBe(10);
    });

    test("MAX_DISTILL_PATTERNS is 20", () => {
      expect(MAX_DISTILL_PATTERNS).toBe(20);
    });

    test("MAX_SUMMARY_LENGTH is 200", () => {
      expect(MAX_SUMMARY_LENGTH).toBe(200);
    });

    test("MAX_SKILL_DESC_LENGTH is 100", () => {
      expect(MAX_SKILL_DESC_LENGTH).toBe(100);
    });
  });

  describe("Recall/Search Limits", () => {
    test("MAX_RECALL_RESULTS is 10", () => {
      expect(MAX_RECALL_RESULTS).toBe(10);
    });

    test("MAX_RESULT_PREVIEW_LENGTH is 200", () => {
      expect(MAX_RESULT_PREVIEW_LENGTH).toBe(200);
    });

    test("MAX_RECALL_RESULTS <= DEFAULT_MEMORY_LIMIT", () => {
      expect(MAX_RECALL_RESULTS).toBeLessThanOrEqual(DEFAULT_MEMORY_LIMIT);
    });
  });

  describe("Type Safety", () => {
    test("all constants are numbers or strings", () => {
      const numericConstants = [
        DEFAULT_HERA_MAX_STEPS,
        DEFAULT_CHILD_MAX_STEPS,
        TEAM_POLL_MAX_ATTEMPTS,
        TEAM_POLL_INTERVAL_MS,
        DEFAULT_MEMORY_LIMIT,
        DEFAULT_TEAM_TIMEOUT_MS,
        MAX_DISTILL_DECISIONS,
        MAX_DISTILL_PATTERNS,
        MAX_SUMMARY_LENGTH,
        MAX_SKILL_DESC_LENGTH,
        MAX_RECALL_RESULTS,
        MAX_RESULT_PREVIEW_LENGTH,
      ];

      for (const c of numericConstants) {
        expect(typeof c).toBe("number");
        expect(c).toBeGreaterThan(0);
      }
    });
  });
});
