import { describe, expect, test } from "bun:test";
import {
  normalizeTeamWorkflowRecipe,
  summarizeTeamWorkflowRecipe,
  teamWorkflowRecipePreview,
} from "./workflow-recipe.js";

describe("normalizeTeamWorkflowRecipe", () => {
  test("fills missing step ids and trims titles", () => {
    const recipe = normalizeTeamWorkflowRecipe({
      id: "demo",
      name: "Demo Recipe",
      mode: "recipe",
      steps: [
        { type: "agent", title: "  Plan work  ", actor: "planner" },
        { id: "step-2", type: "approval", title: "  Approve  ", dependsOn: ["step-1", ""] },
      ],
    });

    expect(recipe.steps[0].id).toBe("step-1");
    expect(recipe.steps[0].title).toBe("Plan work");
    expect(recipe.steps[1].id).toBe("step-2");
    expect(recipe.steps[1].dependsOn).toEqual(["step-1"]);
  });
});

describe("summarizeTeamWorkflowRecipe", () => {
  test("renders a readable summary", () => {
    const summary = summarizeTeamWorkflowRecipe({
      id: "demo",
      name: "Demo Recipe",
      description: "Test recipe",
      mode: "recipe",
      steps: [{ id: "step-1", type: "agent", title: "Plan", actor: "planner" }],
    });

    expect(summary).toContain("Workflow recipe: Demo Recipe");
    expect(summary).toContain("Description: Test recipe");
    expect(summary).toContain("[agent] Plan @planner");
  });
});

describe("teamWorkflowRecipePreview", () => {
  test("renders recipe preview", () => {
    const preview = teamWorkflowRecipePreview({
      id: "demo",
      name: "Demo Recipe",
      description: "Test recipe",
      mode: "recipe",
      steps: [{ id: "step-1", type: "message", title: "Handoff", input: "Share findings" }],
    });

    expect(preview).toContain('Recipe "Demo Recipe" (demo)');
    expect(preview).toContain("Mode: recipe");
    expect(preview).toContain("[message] Handoff");
    expect(preview).toContain(":: Share findings");
  });
});
