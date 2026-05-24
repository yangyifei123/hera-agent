import type {
  TeamWorkflowRecipe,
  TeamWorkflowRecipeInput,
  TeamWorkflowStep,
  TeamWorkflowStepInput,
} from "../types.js";

export function normalizeTeamWorkflowRecipe(recipe: TeamWorkflowRecipeInput): TeamWorkflowRecipe {
  return {
    ...recipe,
    steps: recipe.steps.map((step, index) => normalizeStep(step, index)),
  };
}

export function summarizeTeamWorkflowRecipe(
  recipe?: TeamWorkflowRecipeInput | TeamWorkflowRecipe
): string {
  if (!recipe) return "No workflow recipe defined yet.";

  const lines = [
    `Workflow recipe: ${recipe.name}`,
    recipe.description ? `Description: ${recipe.description}` : undefined,
    `Steps:`,
    ...recipe.steps.map((step, index) => {
      const actor = step.actor ? ` @${step.actor}` : "";
      const deps =
        step.dependsOn && step.dependsOn.length > 0 ? ` <- ${step.dependsOn.join(", ")}` : "";
      return `  ${index + 1}. [${step.type}] ${step.title}${actor}${deps}`;
    }),
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function teamWorkflowRecipePreview(
  recipe: TeamWorkflowRecipeInput | TeamWorkflowRecipe
): string {
  const normalized = normalizeTeamWorkflowRecipe(recipe);
  return [
    `Recipe "${normalized.name}" (${normalized.id})`,
    normalized.description ? normalized.description : "No description provided.",
    `Mode: ${normalized.mode}`,
    `Steps:`,
    ...normalized.steps.map(
      (step, index) =>
        `  ${index + 1}. ${step.id} [${step.type}] ${step.title}${step.actor ? ` @${step.actor}` : ""}${step.input ? ` :: ${step.input}` : ""}`
    ),
  ].join("\n");
}

function normalizeStep(
  step: TeamWorkflowStepInput | TeamWorkflowStep,
  index: number
): TeamWorkflowStep {
  return {
    ...step,
    id: step.id?.trim() ? step.id : `step-${index + 1}`,
    title: step.title.trim(),
    dependsOn: step.dependsOn?.filter(Boolean),
  };
}
