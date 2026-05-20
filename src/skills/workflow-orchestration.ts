import type { SkillDefinition } from "../types.js";

export const WORKFLOW_ORCHESTRATION: SkillDefinition = {
  name: "workflow-orchestration",
  description: "Automatically analyze task complexity and apply workflows",
  trigger: "On receiving user task",
  category: "builtin",
  prompt: `# Workflow Orchestration Skill

## When to Use
Automatically analyze every user task for complexity. If the task is complex (multi-step, requires multiple agents, has approval gates), propose a workflow.

## Complexity Indicators

### High Complexity (use workflow)
- **Multiple distinct steps**: "create, test, and deploy" = 3 steps
- **Multiple agents needed**: Requires coder + tester + reviewer
- **Destructive operations**: delete, deploy, migrate, refactor
- **Approval mentions**: "review", "approve", "verify", "confirm"
- **Estimated duration > 5 minutes**: Large refactoring, multi-file changes
- **External dependencies**: API calls, database migrations, deployments
- **Risk factors**: Production changes, data deletion, security modifications

### Low Complexity (direct execution)
- **Single action**: "fix typo in README"
- **Well-defined**: Clear, unambiguous task
- **Quick execution**: < 2 minutes
- **No approval needed**: Safe, reversible changes
- **No dependencies**: Self-contained task

## Workflow Generation Process

### 1. Analyze
Parse task description and identify:
- **Steps**: Break down into discrete actions
- **Dependencies**: Which steps depend on others?
- **Agents**: Which agents are best suited for each step?
- **Risks**: What could go wrong?
- **Approval points**: Where should user confirm?

### 2. Design
Create workflow with appropriate mode:
- **Serial**: Steps must run in order (build → test → deploy)
- **Parallel**: Independent steps run concurrently (multiple code reviews)
- **DAG**: Complex dependencies (parallel builds, then merge, then deploy)

### 3. Present
Show execution plan to user with:
- **Steps breakdown**: Numbered list of actions
- **Agent assignments**: Who does what
- **Estimated time**: How long will it take
- **Potential risks**: What to watch out for
- **Approval gates**: Where user input is needed

### 4. Confirm
Request user approval before execution:
- Display the plan clearly
- Wait for explicit approval
- Allow user to modify the plan
- Proceed only after confirmation

### 5. Execute
Run workflow via \`hera_execute_workflow\`:
- Monitor progress
- Handle errors gracefully
- Report status updates
- Pause at approval gates

### 6. Report
Summarize results:
- What was completed
- Any issues encountered
- Next steps if applicable

## Workflow Modes

### Serial Mode
Steps execute in sequence, output from one step feeds into the next.

**Use when**:
- Steps have strict ordering (build before test)
- Each step needs previous step's output
- Sequential dependencies exist

**Example**: Refactor → Test → Review → Deploy

### Parallel Mode
All steps execute concurrently.

**Use when**:
- Steps are independent
- No shared state between steps
- Want maximum speed

**Example**: Review file A | Review file B | Review file C

### DAG Mode
Complex dependency graph with mixed parallel and serial execution.

**Use when**:
- Some steps can run in parallel, others must wait
- Multiple dependency chains
- Optimizing for both speed and correctness

**Example**:
\`\`\`
Plan
├─ Dev (parallel)
│  ├─ Feature A
│  └─ Feature B
├─ Test (after Dev)
│  ├─ Unit tests
│  └─ Integration tests
└─ Deploy (after Test)
\`\`\`

## Example Workflow

**Task**: "Refactor authentication module, add tests, and update docs"

**Analysis**:
- Multiple steps: refactor, test, document
- Multiple agents: coder, tester, documenter
- Approval needed: before merging changes
- Estimated time: 10-15 minutes
- Risk: Breaking existing auth functionality

**Workflow Design**:
\`\`\`
Mode: DAG

Steps:
1. Analyze (coder): Review current auth code
2. Refactor (coder): Implement changes [depends on: 1]
3. Test (tester): Write and run tests [depends on: 2]
4. Document (documenter): Update docs [depends on: 2]
5. Review (reviewer): Code review [depends on: 3, 4]
6. Approval Gate: Request user approval [depends on: 5]
7. Merge: Integrate changes [depends on: 6]
\`\`\`

**Execution Plan**:
- Step 1 runs first (analyze)
- Step 2 runs after step 1 (refactor)
- Steps 3 and 4 run in parallel after step 2 (test + docs)
- Step 5 runs after both 3 and 4 complete (review)
- Step 6 waits for user approval
- Step 7 runs after approval (merge)

**Estimated Time**: 12 minutes
**Risks**:
- Refactoring may break existing functionality
- Tests may reveal unexpected issues

## Tools

### hera_create_workflow
Define workflow structure with steps and dependencies.

\`\`\`typescript
hera_create_workflow({
  name: "auth-refactor-workflow",
  description: "Refactor authentication with tests and docs",
  mode: "dag",
  steps: [
    { name: "Analyze", type: "agent", executor: "coder" },
    { name: "Refactor", type: "agent", executor: "coder", dependencies: ["step-1"] },
    { name: "Test", type: "agent", executor: "tester", dependencies: ["step-2"] },
    { name: "Document", type: "agent", executor: "documenter", dependencies: ["step-2"] },
    { name: "Review", type: "agent", executor: "reviewer", dependencies: ["step-3", "step-4"] },
    { name: "Approval", type: "approval", dependencies: ["step-5"] },
  ]
})
\`\`\`

### hera_execute_workflow
Run workflow with approval requirement.

\`\`\`typescript
hera_execute_workflow({
  workflowId: "workflow-id",
  requireApproval: true,
  context: { module: "auth", files: ["auth.ts", "auth.test.ts"] }
})
\`\`\`

### hera_approve_workflow
Approve and execute after user confirmation.

\`\`\`typescript
hera_approve_workflow({
  workflowId: "workflow-id",
  context: { approved: true }
})
\`\`\`

### hera_get_workflow_status
Check execution progress.

\`\`\`typescript
hera_get_workflow_status({
  executionId: "execution-id"
})
\`\`\`

## Decision Tree

\`\`\`
User Task
├─ Simple? (1 step, < 2 min, no approval)
│  └─ Execute directly
└─ Complex? (multi-step, > 5 min, or approval needed)
   ├─ Analyze complexity
   ├─ Design workflow
   ├─ Present plan
   ├─ Request approval
   ├─ Execute workflow
   └─ Report results
\`\`\`

## Tips

### Start Conservative
When in doubt, use a workflow. Better to ask for approval than to make unwanted changes.

### Clear Communication
Always explain why you're proposing a workflow and what it will do.

### Flexible Execution
Allow users to modify the workflow before execution.

### Monitor Progress
Keep users informed during long-running workflows.

### Learn from Feedback
If users reject workflows for simple tasks, adjust your complexity threshold.
`,
};

export function getWorkflowOrchestrationPrompt(): string {
  return WORKFLOW_ORCHESTRATION.prompt;
}
