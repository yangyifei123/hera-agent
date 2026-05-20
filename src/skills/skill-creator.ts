import type { SkillDefinition } from "../types.js";

export const SKILL_CREATOR: SkillDefinition = {
  name: "skill-creator",
  description: "Dynamically create new skills from patterns and requirements",
  trigger: "After brainstorming identifies reusable pattern",
  category: "builtin",
  prompt: `# Skill Creator Skill

## Purpose
Create new skills when:
- Brainstorming identifies a reusable pattern
- Task requires domain-specific knowledge not in existing skills
- Workflow step needs specialized behavior
- User explicitly requests skill creation

## Skill Creation Process

### 1. Define Scope
Ask yourself:
- What specific problem does this skill solve?
- What is the single responsibility of this skill?
- When should this skill be used vs not used?

### 2. Identify Trigger
Determine activation conditions:
- **Task-based**: "When implementing API endpoints"
- **Context-based**: "When working with financial data"
- **Keyword-based**: "When user mentions 'security audit'"
- **Tool-based**: "After running tests"

### 3. Write Prompt
Create clear, actionable instructions:
- **What to do**: Specific steps or checks
- **How to do it**: Concrete examples
- **When to skip**: Exceptions and edge cases
- **Output format**: Expected result structure

### 4. Test Mentally
Walk through scenarios:
- Does this skill help with the original problem?
- Are the instructions clear and unambiguous?
- Can it be combined with other skills via skill-combo?
- Does it overlap with existing skills?

### 5. Create Skill
Use \`hera_create_skill\` tool with:
- **name**: kebab-case, descriptive (e.g., "api-security-validator")
- **description**: One-line summary
- **trigger**: When to activate
- **prompt**: Full instructions from step 3

### 6. Validate
Test the new skill:
- Apply it to the original task
- Check if it produces expected results
- Verify it doesn't conflict with existing skills

## Skill Design Principles

### Single Responsibility
One skill, one purpose. Don't create "swiss army knife" skills.

**Good**: "validate-api-security" - checks API endpoints for security issues
**Bad**: "api-helper" - does validation, documentation, testing, and deployment

### Clear Trigger
Make it obvious when to use the skill.

**Good**: "When reviewing or implementing API endpoints"
**Bad**: "When working with code"

### Actionable Prompt
Provide specific instructions, not vague guidelines.

**Good**: "Check for: SQL injection (parameterized queries), XSS (input sanitization), CSRF (token validation)"
**Bad**: "Make sure the API is secure"

### Composable
Design skills to work well with skill-combo.

**Good**: "rate-limiting" + "api-security-validator" + "error-handling"
**Bad**: Skills that duplicate or contradict each other

### Documented
Include examples in the prompt.

**Good**: Prompt includes "Example: For endpoint POST /users, check: auth required, input validation, rate limit"
**Bad**: No examples, just abstract rules

## Skill Template

Use this template when creating skills:

\`\`\`
# [Skill Name] Skill

## Purpose
[What problem does this solve?]

## When to Use
- [Condition 1]
- [Condition 2]
- [Condition 3]

## When NOT to Use
- [Exception 1]
- [Exception 2]

## Instructions
1. [Step 1 with specific action]
2. [Step 2 with specific action]
3. [Step 3 with specific action]

## Checklist
- [ ] [Check 1]
- [ ] [Check 2]
- [ ] [Check 3]

## Example
[Concrete example showing skill in action]

## Tools
- [Tool 1]: [When to use it]
- [Tool 2]: [When to use it]
\`\`\`

## Integration with Workflow

Created skills can be:
- **Added to agents**: Include in agent's skill list during creation
- **Used in workflows**: Assign to workflow steps
- **Combined**: Use with skill-combo for complex tasks
- **Evolved**: Agents can improve skills via evolution

## Example: Creating API Security Validator

**Task**: "Always validate API responses for security vulnerabilities"

**Skill Definition**:
- **Name**: "api-security-validator"
- **Description**: "Validate API endpoints for common security vulnerabilities"
- **Trigger**: "When reviewing or implementing API endpoints"
- **Prompt**:

\`\`\`
# API Security Validator Skill

## Purpose
Ensure API endpoints are secure against common vulnerabilities.

## When to Use
- Implementing new API endpoints
- Reviewing existing API code
- Before deploying API changes

## Security Checklist
- [ ] **SQL Injection**: Use parameterized queries, never string concatenation
- [ ] **XSS**: Sanitize all user input, escape output
- [ ] **CSRF**: Require CSRF tokens for state-changing operations
- [ ] **Auth Bypass**: Verify authentication on all protected endpoints
- [ ] **Rate Limiting**: Implement rate limits to prevent abuse
- [ ] **Input Validation**: Validate all input against expected schema
- [ ] **Error Handling**: Don't leak sensitive info in error messages
- [ ] **HTTPS**: Ensure all endpoints use HTTPS in production

## Example
For endpoint \`POST /api/users\`:
- ✓ Requires authentication token
- ✓ Validates email format and password strength
- ✓ Rate limited to 5 requests/minute
- ✓ Uses parameterized SQL queries
- ✓ Returns generic error messages
\`\`\`

**Usage**:
\`\`\`typescript
hera_create_skill({
  name: "api-security-validator",
  description: "Validate API endpoints for common security vulnerabilities",
  trigger: "When reviewing or implementing API endpoints",
  prompt: [full prompt above]
})
\`\`\`

## Tips

### Start Simple
Create focused skills first, expand later if needed.

### Reuse Patterns
Look at existing skills for inspiration and structure.

### Test Early
Validate the skill on real tasks before committing.

### Iterate
Skills can be updated and improved over time.

### Document Context
Include why the skill was created in the description.
`,
};

export function getSkillCreatorPrompt(): string {
  return SKILL_CREATOR.prompt;
}
