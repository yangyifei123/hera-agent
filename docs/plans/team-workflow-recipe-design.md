# Team Workflow Recipe Design

## Goal

Add a simple, user-editable workflow layer for agent teams.

The user should be able to define, inspect, and modify a team workflow without learning the full internal workflow engine. The workflow surface should stay thin and readable, while Hera keeps the existing execution machinery underneath.

## Problem

Current team setup exposes several internal concepts at once:

- team coordination modes: `parallel`, `sequential`, `adaptive`
- team management modes: `simple`, `okr`, `tree`, `control`
- workflow engine modes: `serial`, `parallel`, `dag`

That is already useful for power users, but it is too much structure for a user who just wants to say, "this team should do these steps in this order" and then edit that flow later.

## Recommendation

Use a **Recipe** workflow layer.

Recipe is a small, declarative definition of a team workflow. It does not expose DAGs or engine internals directly. It is just a list of editable steps with lightweight metadata.

### Why this shape

- Easy to understand at a glance
- Easy to edit in form or raw text
- Easy to seed from templates
- Easy to compile into the existing workflow engine
- Easy to preview before saving

## Data Shape

```ts
type TeamWorkflowRecipe = {
  id: string
  name: string
  description?: string
  mode: "recipe"
  steps: Array<{
    id: string
    type: "agent" | "message" | "approval" | "tool"
    title: string
    actor?: string
    input?: string
    dependsOn?: string[]
    editable?: boolean
  }>
}
```

### Step semantics

- `agent`: assign work to one member or a role
- `message`: send a note, handoff, or prompt fragment
- `approval`: pause for user approval
- `tool`: invoke a tool-oriented step when needed

The recipe is intentionally smaller than the internal workflow model. The compiler can translate recipe steps into existing workflow or team actions.

## User Experience

### Creation

1. User picks a starter recipe or blank recipe.
2. Hera shows an editable step list.
3. User can edit in structured form or raw JSON/YAML.
4. Hera previews the compiled execution plan.
5. User saves and runs the team.

### Editing

Users should be able to change:

- recipe name and description
- step order
- step type
- assigned actor
- input text
- approval points

The editor should stay minimal. No canvas, no graph editor, no visible DAG logic in the first version.

## Execution Model

Recipe should be compiled into the existing engine, not replace it.

Suggested mapping:

- ordered recipe steps map to serial execution by default
- independent groups can still use existing parallel execution internally
- approval steps translate into the current approval gate flow
- message steps use existing team messaging and shared workspace patterns

This keeps the feature additive. It does not force a rewrite of `TeamManager` or `WorkflowManager`.

## Persistence

Best fit is one of these:

- store recipe on the team record
- or store as `team-workflow-<id>` in MemoryStore and link from the team

Either works, but the user-facing model should still feel like "this team has one editable workflow".

Recommended default: keep the recipe linked to the team so team setup and workflow setup stay close together.

## Implementation Touchpoints

- `src/team/manager.ts`
  - add recipe-aware team metadata
  - load/save recipe with team definition
- `src/team/templates.ts`
  - add starter recipes
- `src/workflow/manager.ts`
  - compile recipe into current execution flow
- `src/workflow/templates.ts`
  - add workflow starter templates, if needed
- `src/tools/team-tools.ts`
  - create, preview, edit, and run recipes
- `src/tools/workflow-tools.ts`
  - expose recipe preview and execution hooks
- `src/constants.ts`
  - shared recipe step labels and defaults
- `README.md`
  - explain recipe-first UX
- `docs/launch/*.md`
  - show recipe creation in demo and launch copy

## MVP Scope

Keep first release small:

- blank recipe + starter templates
- structured editor + raw JSON/YAML view
- preview before save
- run recipe through existing team execution path

Do not include in v1:

- drag-and-drop canvas
- full DAG editor
- expression language for conditions
- nested workflow subgraphs

## Risks

- If recipe steps mirror engine internals too closely, the UI will get noisy again.
- If recipe adds a second full workflow model, the codebase will split in two.
- If editing and execution use different step semantics, previews will feel untrustworthy.

## Success Criteria

- User can define a team workflow without touching internal engine modes.
- User can preview the result before saving.
- User can edit the workflow later without recreating the team.
- Existing team execution keeps working for current users.
