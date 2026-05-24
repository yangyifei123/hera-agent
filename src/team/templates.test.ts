import { describe, test, expect } from "bun:test";
import { TEAM_TEMPLATES, getTeamTemplate, getTeamTemplateNames } from "./templates.js";

describe("TEAM_TEMPLATES", () => {
  test("has code-review template", () => {
    expect(TEAM_TEMPLATES["code-review"]).toBeDefined();
  });

  test("has dev-pipeline template", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"]).toBeDefined();
  });

  test("has research template", () => {
    expect(TEAM_TEMPLATES["research"]).toBeDefined();
  });

  test("all templates have required fields", () => {
    for (const tpl of Object.values(TEAM_TEMPLATES)) {
      expect(tpl.description).toBeTruthy();
      expect(Array.isArray(tpl.members)).toBe(true);
      expect(tpl.members.length).toBeGreaterThan(0);
      expect(["parallel", "sequential", "adaptive"]).toContain(tpl.coordination);
      expect(["simple", "okr", "tree", "control"]).toContain(tpl.management);
      expect(tpl.workflow).toBeDefined();
      expect(tpl.workflow?.mode).toBe("recipe");
      expect(tpl.workflow?.steps.length).toBeGreaterThan(0);
      for (const member of tpl.members) {
        expect(member.role).toBeTruthy();
        expect(member.template).toBeTruthy();
      }
    }
  });
});

describe("code-review template", () => {
  test("has 2 members", () => {
    expect(TEAM_TEMPLATES["code-review"].members).toHaveLength(2);
  });

  test("is parallel coordination", () => {
    expect(TEAM_TEMPLATES["code-review"].coordination).toBe("parallel");
  });

  test("has reviewer", () => {
    const reviewer = TEAM_TEMPLATES["code-review"].members.find((m) => m.role === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.template).toBe("reviewer");
  });

  test("has bug-hunter", () => {
    const hunter = TEAM_TEMPLATES["code-review"].members.find((m) => m.role === "bug-hunter");
    expect(hunter).toBeDefined();
    expect(hunter!.template).toBe("debugger");
  });

  test("has recipe", () => {
    expect(TEAM_TEMPLATES["code-review"].workflow).toBeDefined();
    expect(TEAM_TEMPLATES["code-review"].workflow?.steps).toHaveLength(3);
  });
});

describe("dev-pipeline template", () => {
  test("has 3 members", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"].members).toHaveLength(3);
  });

  test("is sequential coordination", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"].coordination).toBe("sequential");
  });

  test("has architect first", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"].members[0].template).toBe("architect");
  });

  test("has coder second", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"].members[1].template).toBe("coder");
  });

  test("has tester last", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"].members[2].template).toBe("tester");
  });

  test("has recipe", () => {
    expect(TEAM_TEMPLATES["dev-pipeline"].workflow).toBeDefined();
    expect(TEAM_TEMPLATES["dev-pipeline"].workflow?.steps).toHaveLength(4);
  });
});

describe("research template", () => {
  test("has 2 members", () => {
    expect(TEAM_TEMPLATES["research"].members).toHaveLength(2);
  });

  test("is sequential coordination", () => {
    expect(TEAM_TEMPLATES["research"].coordination).toBe("sequential");
  });

  test("has researcher first", () => {
    expect(TEAM_TEMPLATES["research"].members[0].template).toBe("researcher");
  });

  test("has writer second", () => {
    expect(TEAM_TEMPLATES["research"].members[1].template).toBe("documenter");
  });

  test("has recipe", () => {
    expect(TEAM_TEMPLATES["research"].workflow).toBeDefined();
    expect(TEAM_TEMPLATES["research"].workflow?.steps).toHaveLength(3);
  });
});

describe("getTeamTemplate", () => {
  test("returns template for valid name", () => {
    const tpl = getTeamTemplate("code-review");
    expect(tpl).toBeDefined();
    expect(tpl!.members).toHaveLength(2);
  });

  test("returns undefined for invalid name", () => {
    const tpl = getTeamTemplate("nonexistent");
    expect(tpl).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const tpl = getTeamTemplate("");
    expect(tpl).toBeUndefined();
  });
});

describe("getTeamTemplateNames", () => {
  test("returns all template names", () => {
    const names = getTeamTemplateNames();
    expect(names).toContain("code-review");
    expect(names).toContain("dev-pipeline");
    expect(names).toContain("research");
  });

  test("returns exactly 3 templates", () => {
    expect(getTeamTemplateNames()).toHaveLength(3);
  });
});
