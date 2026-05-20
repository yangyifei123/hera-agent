import type { SkillDefinition } from "../types.js";

export const BRAINSTORMING: SkillDefinition = {
  name: "brainstorming",
  description: "Generate multiple solution approaches for complex problems",
  trigger: "When existing skills are insufficient or task is novel",
  category: "builtin",
  prompt: `# Brainstorming Skill

## Purpose
Generate creative solutions when:
- Existing skills don't cover the task
- Multiple approaches are possible
- Novel problem requiring new patterns
- User explicitly requests brainstorming

## Process

### 1. Diverge (Generate 3-5 Approaches)
Consider different paradigms and perspectives:
- **Functional vs OOP vs Declarative**: Different programming paradigms
- **Simple vs Flexible**: Trade-off between ease of use and extensibility
- **Performance vs Maintainability**: Optimize for speed or long-term maintenance
- **Existing patterns vs Novel solutions**: Reuse known patterns or innovate

### 2. Analyze Each Approach
For each approach, evaluate:
- **Pros**: What are the advantages?
- **Cons**: What are the drawbacks?
- **Complexity**: Low/Medium/High implementation difficulty
- **Maintenance**: Easy/Moderate/Hard to maintain long-term
- **Performance**: Fast/Moderate/Slow execution
- **Alignment**: How well does it fit project patterns?

### 3. Converge (Select Best Approach)
Choose based on:
- Project constraints (time, resources, expertise)
- User preferences from memory
- Long-term maintainability
- Team expertise and familiarity
- Risk tolerance

### 4. Skill Extraction
If the selected approach is reusable:
- Identify the core pattern
- Propose creating a new skill via skill-creator
- Document when to use this pattern

## Output Format

Present approaches in structured format:

**Approach 1: [Name]**
- Description: [Brief explanation]
- Pros: [List advantages]
- Cons: [List drawbacks]
- Complexity: Low/Medium/High
- Best for: [Use cases]

**Approach 2: [Name]**
...

**Recommendation**: [Selected approach]

**Reasoning**: [Why this approach is best for this situation]

**Reusable Pattern**: [If applicable, describe the pattern that could become a skill]

## When NOT to Use
- Task is straightforward and covered by existing skills
- Only one obvious solution exists
- Time-sensitive tasks requiring immediate action
- User has already specified the approach

## Example

Task: "Implement user authentication with social login"

**Approach 1: OAuth 2.0 with Passport.js**
- Description: Use established OAuth library with multiple providers
- Pros: Battle-tested, supports many providers, good documentation
- Cons: Heavy dependency, learning curve for configuration
- Complexity: Medium
- Best for: Production apps needing multiple social providers

**Approach 2: Custom JWT with Provider APIs**
- Description: Direct integration with Google/GitHub APIs, custom JWT handling
- Pros: Lightweight, full control, no middleware dependencies
- Cons: More code to maintain, security responsibility
- Complexity: High
- Best for: Simple use cases with 1-2 providers

**Approach 3: Auth0 / Supabase Auth**
- Description: Third-party authentication service
- Pros: Minimal code, managed security, quick setup
- Cons: Vendor lock-in, monthly cost, less control
- Complexity: Low
- Best for: MVPs and rapid prototyping

**Recommendation**: Approach 1 (Passport.js)

**Reasoning**: Project needs multiple social providers (Google, GitHub, Twitter), team has Node.js expertise, and production-grade security is critical. The learning curve is acceptable given the long-term benefits.

**Reusable Pattern**: "oauth-integration" skill for future OAuth implementations
`,
};

export function getBrainstormingPrompt(): string {
  return BRAINSTORMING.prompt;
}
