import { describe, it, expect } from "bun:test";
import {
  createObjective,
  createKeyResult,
  updateKeyResult,
  calculateProgress,
  calculateTeamProgress,
  formatObjective,
  formatTeamProgress,
} from "./okr-manager.js";

describe("okr-manager", () => {
  describe("createKeyResult", () => {
    it("should create a key result with generated ID", () => {
      const kr = createKeyResult("Write 10 tests", 10, "tests");
      expect(kr.id).toMatch(/^kr-/);
      expect(kr.description).toBe("Write 10 tests");
      expect(kr.target).toBe(10);
      expect(kr.current).toBe(0);
      expect(kr.metric).toBe("tests");
    });

    it("should accept initial current value", () => {
      const kr = createKeyResult("Deployments", 5, "deploys", 2);
      expect(kr.current).toBe(2);
    });
  });

  describe("drive-to-zero key results (target 0)", () => {
    it("reports 100% when a reduce-to-zero KR is met and not 0% while it is", () => {
      let obj = createObjective("Zero Bugs", [createKeyResult("open bugs", 0, "count", 5)]);
      // 5 remaining → 0%
      expect(calculateProgress(obj)).toBe(0);
      const krId = obj.keyResults[0].id;
      // drive it to zero → met → 100%
      obj = updateKeyResult(obj, krId, 0);
      expect(obj.keyResults[0].current).toBe(0);
      expect(calculateProgress(obj)).toBe(100);
      expect(formatObjective(obj)).toContain("(100%)");
    });
  });

  describe("createObjective", () => {
    it("should create an objective with generated ID", () => {
      const krs = [createKeyResult("KR1", 100, "units")];
      const obj = createObjective("Ship v2.0", krs, "senior-dev");
      expect(obj.id).toMatch(/^obj-/);
      expect(obj.name).toBe("Ship v2.0");
      expect(obj.keyResults).toHaveLength(1);
      expect(obj.assignee).toBe("senior-dev");
    });

    it("should create objective without optional fields", () => {
      const obj = createObjective("Basic goal", []);
      expect(obj.assignee).toBeUndefined();
      expect(obj.deadline).toBeUndefined();
      expect(obj.keyResults).toHaveLength(0);
    });
  });

  describe("updateKeyResult", () => {
    it("should update key result progress immutably", () => {
      const kr = createKeyResult("Coverage", 100, "%");
      const obj = createObjective("Quality", [kr]);
      const updated = updateKeyResult(obj, kr.id, 75);
      expect(updated.keyResults[0].current).toBe(75);
      // Original unchanged (immutability)
      expect(obj.keyResults[0].current).toBe(0);
    });

    it("should cap progress at target value", () => {
      const kr = createKeyResult("Tasks", 5, "tasks");
      const obj = createObjective("Sprint", [kr]);
      const updated = updateKeyResult(obj, kr.id, 999);
      expect(updated.keyResults[0].current).toBe(5);
    });

    it("should throw on missing key result ID", () => {
      const obj = createObjective("Test", [createKeyResult("KR", 10, "x")]);
      expect(() => updateKeyResult(obj, "nonexistent", 5)).toThrow(
        'Key result "nonexistent" not found'
      );
    });
  });

  describe("calculateProgress", () => {
    it("should return 0 for objective with no key results", () => {
      const obj = createObjective("Empty", []);
      expect(calculateProgress(obj)).toBe(0);
    });

    it("should calculate weighted average across key results", () => {
      const kr1 = createKeyResult("KR1", 100, "%", 50); // 50%
      const kr2 = createKeyResult("KR2", 100, "%", 100); // 100%
      const obj = createObjective("Average", [kr1, kr2]);
      // (50 + 100) / 2 = 75
      expect(calculateProgress(obj)).toBe(75);
    });

    it("should handle zero target gracefully", () => {
      const kr = createKeyResult("Bad KR", 0, "x", 5);
      const obj = createObjective("Zero target", [kr]);
      expect(calculateProgress(obj)).toBe(0);
    });

    it("should cap individual KR at 100%", () => {
      const kr = createKeyResult("Overachiever", 10, "tasks", 20); // 200% but capped at 100
      const obj = createObjective("Cap test", [kr]);
      expect(calculateProgress(obj)).toBe(100);
    });
  });

  describe("calculateTeamProgress", () => {
    it("should return 0 for empty objectives", () => {
      expect(calculateTeamProgress([])).toBe(0);
    });

    it("should average across all objectives", () => {
      const obj1 = createObjective("Obj1", [createKeyResult("KR1", 100, "%", 100)]); // 100%
      const obj2 = createObjective("Obj2", [createKeyResult("KR2", 100, "%", 50)]); // 50%
      // (100 + 50) / 2 = 75
      expect(calculateTeamProgress([obj1, obj2])).toBe(75);
    });
  });

  describe("formatObjective", () => {
    it("should format objective with progress and key results", () => {
      const kr = createKeyResult("Coverage", 100, "%", 80);
      const obj = createObjective("Quality", [kr], "dev");
      const formatted = formatObjective(obj);
      expect(formatted).toContain("Quality");
      expect(formatted).toContain("80%");
      expect(formatted).toContain("dev");
    });
  });

  describe("formatTeamProgress", () => {
    it("should show message when no objectives", () => {
      expect(formatTeamProgress([])).toBe("No objectives defined.");
    });

    it("should show overall progress percentage", () => {
      const obj = createObjective("Goal", [createKeyResult("KR", 10, "items", 5)]);
      const formatted = formatTeamProgress([obj]);
      expect(formatted).toContain("Overall Progress:");
      expect(formatted).toContain("50%");
    });
  });
});
