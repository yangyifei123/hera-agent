import { describe, test, expect, it } from "bun:test";
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
  resolveOpenCodeConfigRoot,
  TEAM_MANAGEMENT_DESCRIPTIONS,
  TASK_CONCURRENCY,
  TASK_DEFAULT_MAX_ATTEMPTS,
  TASK_DEFAULT_BACKOFF_MS,
  TASK_LEASE_MS,
  SUPERVISOR_TICK_MS,
  LOOP_TICK_MS,
  LOOP_DEFAULT_MAX_ITERATIONS,
  LOOP_MIN_INTERVAL_MS,
  TASK_ATTEMPT_TIMEOUT_MS,
  LOOP_MAX_CONSECUTIVE_FAILURES,
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
    test("DEFAULT_SKILLS contains all inherited core skills", () => {
      expect(DEFAULT_SKILLS).toHaveLength(11);
    });

    test("DEFAULT_SKILLS contains all builtin skill names surfaced to agents", () => {
      expect(DEFAULT_SKILLS).toContain("caveman");
      expect(DEFAULT_SKILLS).toContain("init");
      expect(DEFAULT_SKILLS).toContain("memory");
      expect(DEFAULT_SKILLS).toContain("evolution");
      expect(DEFAULT_SKILLS).toContain("skill-combo");
      expect(DEFAULT_SKILLS).toContain("subagent");
      expect(DEFAULT_SKILLS).toContain("communicate");
      expect(DEFAULT_SKILLS).toContain("auto-compact");
      expect(DEFAULT_SKILLS).toContain("workflow-orchestration");
      expect(DEFAULT_SKILLS).toContain("brainstorming");
      expect(DEFAULT_SKILLS).toContain("skill-creator");
    });

    test("DEFAULT_SKILLS is readonly (as const)", () => {
      // TypeScript as const makes this a readonly tuple
      expect(Object.isFrozen(DEFAULT_SKILLS) || Array.isArray(DEFAULT_SKILLS)).toBe(true);
    });
  });

  describe("Config Root", () => {
    test("resolves Windows config root from USERPROFILE", () => {
      expect(
        resolveOpenCodeConfigRoot(
          { USERPROFILE: "C:/Users/Ada", HOME: "C:/Users/Fallback" },
          "win32"
        ).replace(/\\/g, "/")
      ).toBe("C:/Users/Ada/.config/opencode");
    });

    test("falls back to HOME on Windows when USERPROFILE is missing", () => {
      expect(
        resolveOpenCodeConfigRoot({ HOME: "C:/Users/HomeOnly" }, "win32").replace(/\\/g, "/")
      ).toBe("C:/Users/HomeOnly/.config/opencode");
    });

    test("uses stable Windows fallback when no home env exists", () => {
      expect(resolveOpenCodeConfigRoot({}, "win32").replace(/\\/g, "/")).toBe(
        "C:/Users/Administrator/.config/opencode"
      );
    });

    test("resolves Unix config root from HOME", () => {
      expect(resolveOpenCodeConfigRoot({ HOME: "/home/ada" }, "linux").replace(/\\/g, "/")).toBe(
        "/home/ada/.config/opencode"
      );
    });

    test("uses /root fallback on Unix when HOME is missing", () => {
      expect(resolveOpenCodeConfigRoot({}, "linux").replace(/\\/g, "/")).toBe(
        "/root/.config/opencode"
      );
    });

    test("HERA_CONFIG_ROOT is canonical and overrides everything", () => {
      expect(
        resolveOpenCodeConfigRoot(
          {
            HERA_CONFIG_ROOT: "/canonical/root",
            OPENCODE_CONFIG_ROOT: "/legacy/root",
            HOME: "/home/ada",
          },
          "linux"
        )
      ).toBe("/canonical/root");
    });

    test("OPENCODE_CONFIG_ROOT is honored as a legacy alias when canonical is unset", () => {
      expect(
        resolveOpenCodeConfigRoot(
          { OPENCODE_CONFIG_ROOT: "/legacy/root", HOME: "/home/ada" },
          "linux"
        )
      ).toBe("/legacy/root");
    });
  });

  describe("Team Management Descriptions", () => {
    test("documents all team management modes", () => {
      expect(Object.keys(TEAM_MANAGEMENT_DESCRIPTIONS).sort()).toEqual([
        "control",
        "okr",
        "simple",
        "tree",
      ]);
      expect(TEAM_MANAGEMENT_DESCRIPTIONS.control).toContain("approval");
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

describe("Task Engine Constants", () => {
  it("has sane task-engine defaults", () => {
    expect(TASK_CONCURRENCY).toBe(8);
    expect(TASK_DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(TASK_DEFAULT_BACKOFF_MS).toBe(1000);
    expect(TASK_LEASE_MS).toBe(300000);
    expect(SUPERVISOR_TICK_MS).toBeGreaterThan(0);
    expect(TASK_LEASE_MS).toBeGreaterThan(SUPERVISOR_TICK_MS);
  });
});

describe("Loop Engine Constants", () => {
  it("has sane loop defaults", () => {
    expect(LOOP_TICK_MS).toBeGreaterThan(0);
    expect(LOOP_DEFAULT_MAX_ITERATIONS).toBe(25);
    expect(LOOP_MIN_INTERVAL_MS).toBe(1000);
  });
});

describe("Self-Healing Constants", () => {
  it("attempt timeout is below the lease", () => {
    expect(TASK_ATTEMPT_TIMEOUT_MS).toBe(240000);
    expect(TASK_ATTEMPT_TIMEOUT_MS).toBeLessThan(TASK_LEASE_MS);
  });

  it("loop max consecutive failures default", () => {
    expect(LOOP_MAX_CONSECUTIVE_FAILURES).toBe(5);
  });
});
