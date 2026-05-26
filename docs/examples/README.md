# Example 1: Code Review Agent

> **ICP**: OpenCode power user who reviews PRs repeatedly
> **Job-to-be-done**: Automate code review with consistent standards

## Setup

```bash
# Install Hera (if not already installed)
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent

# Create a code review agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js create agent code-reviewer --template reviewer --mode all
```

## Run

```bash
# Use the agent to review a file
opencode --agent code-reviewer "review src/auth.ts for security issues, error handling, and code style"
```

## Expected Output

The agent will analyze the file and provide structured feedback covering:
- Security vulnerabilities (hardcoded secrets, injection risks)
- Error handling gaps (uncaught exceptions, missing validation)
- Code style issues (inconsistent naming, missing types)

## Teardown

```bash
opencode run --agent hera "delete code-reviewer"
```

---

# Example 2: Persistent Memory for Project Standards

> **ICP**: Developer who re-explains project conventions in every session
> **Job-to-be-done**: Store and recall project standards across sessions

## Setup

```bash
# Store project standards (persists across sessions)
opencode run --agent hera "remember: our project uses 2-space indentation, strict TypeScript, REST APIs with snake_case fields"

opencode run --agent hera "remember: our testing harness is bun test with files matching *.test.ts"

opencode run --agent hera "remember: our git branch convention is feature/JIRA-123-description"
```

## Run

```bash
# Recall standards in any new session
opencode run --agent hera "recall: code style"
opencode run --agent hera "recall: testing"
opencode run --agent hera "recall: git conventions"
```

## Expected Output

The recall command returns all stored memories matching the query, with timestamps.

## Teardown

```bash
# (Memories persist — no teardown needed)
# To clear specific memory:
opencode run --agent hera "delete memory <memory-id>"
```

---

# Example 3: Parallel Review Team

> **ICP**: Developer reviewing complex PRs with multiple concerns
> **Job-to-be-done**: Run style, security, and logic reviews simultaneously

## Setup

```bash
# Create a review team with parallel coordination
opencode run --agent hera "create review-team with style-reviewer, security-reviewer, and logic-reviewer, mode: parallel"
```

## Run

```bash
# Use the team to review a change
opencode run --agent hera "spawn review-team to review the authentication module in src/auth/"
```

## Expected Output

The team spawns 3 parallel OpenCode sessions:
- `style-reviewer`: Checks naming, formatting, code style
- `security-reviewer`: Checks for vulnerabilities, auth issues, data exposure
- `logic-reviewer`: Checks business logic, edge cases, test coverage

Results are collected and returned together.

## Teardown

```bash
opencode run --agent hera "delete review-team"
opencode run --agent hera "delete style-reviewer"
opencode run --agent hera "delete security-reviewer"
opencode run --agent hera "delete logic-reviewer"
```

---

# Example 4: Skill-to-Agent Upgrade

> **ICP**: Developer with frequently-used prompt patterns
> **Job-to-be-done**: Turn a reusable pattern into a persistent, upgradeable agent

## Setup

```bash
# Create a skill first
opencode run --agent hera "create skill api-docs, description: 'Generates OpenAPI docs from Express routes', trigger: 'when asked to document API endpoints'"

# Use the skill a few times...
opencode run --agent hera "use api-docs to document src/routes/"

# Upgrade to a full agent when the pattern stabilizes
opencode run --agent hera "upgrade skill api-docs to agent api-docs-writer, mode: all"
```

## Run

```bash
# Now use the agent directly
opencode --agent api-docs-writer "document the authentication endpoints"
```

## Expected Output

The agent has the skill's knowledge plus the 11 built-in skills (memory, evolution, workflow orchestration, and more). It remembers past API documentation work and improves over time.

## Teardown

```bash
opencode run --agent hera "delete api-docs-writer"
opencode run --agent hera "delete skill api-docs"
```

---

# Example 5: Agent Packaging and Distribution

> **ICP**: Team lead sharing agent configurations across teams/machines
> **Job-to-be-done**: Package and distribute a configured agent

## Setup

```bash
# Create an agent with custom configuration
opencode run --agent hera "create deploy-bot, mode: all, template: coder"
opencode run --agent hera "remember in agent deploy-bot: our deployment pipeline uses GitHub Actions to deploy to AWS ECS"
```

## Package

```bash
# Package with memory included
opencode run --agent hera "package deploy-bot agent with memory"
# Output: ~/.config/opencode/hera-data/packages/deploy-bot-package.tar.gz
```

## Distribute and Install (on another machine)

```bash
# Transfer the package file to another machine
# Install on target machine
opencode run --agent hera "unpack agent from /path/to/deploy-bot-package.tar.gz"
```

## Run

```bash
# The deployed agent has all configuration and memory intact
opencode --agent deploy-bot "deploy staging to ECS"
```

## Teardown

```bash
# On both machines
opencode run --agent hera "delete deploy-bot"
```

---

# More Recipes

For debugging agents, sequential dev teams, session distillation, self-evolving agents, and packaging flows, see [../SHOWCASE.md](../SHOWCASE.md).
