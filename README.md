# Hera - Agent Factory for OpenCode

> Create persistent AI agents with memory and teams inside OpenCode.

[![Version](https://img.shields.io/badge/version-2.2.0-blue.svg)](https://github.com/yangyifei123/hera-agent/releases/tag/v2.2.0)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-orange.svg)](https://github.com/opencode-ai/opencode)

**Stop re-typing the same prompts.** Hera creates AI agents that remember across sessions, evolve from experience, and coordinate as teams - all inside your existing OpenCode workflow.

> **Scope**: Hera is an OpenCode plugin. It is not a standalone agent platform, not a Claude Code replacement, and not an OpenCode competitor. It extends OpenCode by adding persistent agents, memory, teams, and export tools.

```bash
# 1. Install with npm (recommended; no Bun required)
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent

# 2. Create an agent that remembers
opencode run --agent hera "create my-reviewer, mode: all, template: coder"

# 3. Use it - it persists
opencode --agent my-reviewer "review src/auth.ts for security issues"
```

## Why Hera?

If you use OpenCode and find yourself re-typing prompt patterns - code review, testing, documentation, debugging - Hera turns those patterns into persistent agents that:

- **Remember** across sessions (shared memory pool)
- **Evolve** by reflecting on past work
- **Coordinate** as teams (parallel, sequential, or DAG workflows)
- **Export** as standalone plugins you can share

No Python service, no API server, no new runtime. Runs inside OpenCode.

## 2-Minute Demo

See [docs/CANONICAL_DEMO.md](docs/CANONICAL_DEMO.md) for the full walkthrough. Quick version:

```bash
# Install Hera (npm path; no Bun required)
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent

# Verify
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
# Expected: All checks passed

# Create a code review team
opencode run --agent hera "create review-team with code-reviewer and bug-hunter, mode: parallel"

# Use the team
opencode run --agent hera "spawn review-team to review src/index.ts"

# Memory persists across sessions
opencode run --agent hera "remember: our project uses 2-space indentation and strict TypeScript"
opencode run --agent hera "recall: coding style"
```

## Features

| Feature | What it does |
|---------|-------------|
| **Agent Factory** | Create agents from 10 templates or custom prompts |
| **Persistent Memory** | All agents share a JSON memory store that survives restarts |
| **Self-Evolution** | Agents reflect on sessions and append improvement directives |
| **Team Coordination** | Parallel, sequential, or DAG execution with real OpenCode sessions |
| **Plugin Export** | Agents and teams export as standalone OpenCode plugins |
| **Skill Composition** | 8 built-in skills inherited by every agent |
| **Workflow Engine** | Auto-detects task complexity; proposes workflows for multi-step tasks |
| **Session Distillation** | Extract structured knowledge from conversations |
| **Agent Packaging** | Package/export/import agents with memory as `.tar.gz` |
| **Offline Friendly** | Runtime has zero network dependencies from v2.0+ |

## Quick Start

### Prerequisites

- [OpenCode](https://github.com/opencode-ai/opencode) CLI
- One package manager: npm/Node.js (recommended), Bun, pnpm, or yarn

### Install Options

#### Option A: npm / Node.js (recommended if Bun fails)

```bash
# Linux/macOS
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent

# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode"
npm install --prefix "$env:USERPROFILE\.config\opencode" hera-agent
```

#### Option B: Linux one-shot install

```bash
set -e
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

#### Option C: Bun

```bash
# Linux/macOS
cd ~/.config/opencode && bun add hera-agent

# Windows PowerShell
cd $env:USERPROFILE\.config\opencode; bun add hera-agent
```

#### Option D: Manual tarball install (offline/internal networks)

```bash
# On a machine with internet access
npm pack hera-agent

# Copy hera-agent-<version>.tgz to the target machine, then:
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode /path/to/hera-agent-<version>.tgz
```

#### Option E: Manual source install

```bash
git clone https://github.com/yangyifei123/hera-agent.git
cd hera-agent
npm install
npm run build

mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode /path/to/hera-agent
```

### Verify

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
# Expected: All checks passed

# If installed with Bun, this also works:
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

### Create and Use Agents

```bash
# Create from template
opencode run --agent hera "create my-dev, mode: all, template: coder"

# Use it
opencode --agent my-dev "write a fibonacci function in TypeScript"

# Create a team
opencode run --agent hera "create dev-team with architect, coder, and tester, mode: sequential"

# Store knowledge for all agents
opencode run --agent hera "remember: our API follows REST conventions with snake_case fields"
```

> Important: Use `mode: all` or `mode: primary` for agents you want to call directly with `--agent`. Subagent-mode agents are invoked by other agents, not directly.

## Built-in Skills

Every agent created by Hera inherits these 8 skills:

| Skill | What it does |
|-------|-------------|
| **caveman** | Ultra-compressed communication (~75% token savings) |
| **init** | Auto-detect project context on session start |
| **memory** | Persistent JSON store - remember/recall across sessions |
| **evolution** | Self-improvement through session reflection |
| **skill-combo** | Chain multiple skills on-the-fly |
| **subagent** | Delegate sub-tasks to specialized agents |
| **communicate** | Message passing between team members |
| **auto-compact** | Automatic context window compression |

## Agent Templates

| Template | Mode | Use for |
|----------|------|---------|
| **general** | all | Versatile assistant |
| **coder** | all | Coding with skill-combo |
| **reviewer** | subagent | Code review |
| **researcher** | subagent | Research and analysis |
| **coordinator** | all | Team coordination |
| **architect** | all | System design |
| **debugger** | all | Debugging |
| **tester** | subagent | Testing |
| **documenter** | subagent | Documentation |
| **optimizer** | subagent | Performance optimization |

## Workflow System

Hera auto-detects complex tasks and proposes workflows:

```bash
# Simple task - executes directly
opencode run --agent hera "fix typo in README"

# Complex task - proposes workflow with approval
opencode run --agent hera "refactor auth, add OAuth, write tests, update docs"
```

**Modes**: Serial (sequential), Parallel (concurrent), DAG (dependencies).

See [Workflow Templates](#workflow-templates) for 10 pre-defined templates.

## Agent Packaging & Migration

```bash
# Package agent with memory
opencode run --agent hera "package my-dev agent with memory"

# Export as plugin for distribution
opencode run --agent hera "export my-dev as plugin"

# Import on another machine
opencode run --agent hera "unpack agent from /path/to/my-dev-package.tar.gz"
```

## Configuration

Hera creates `~/.config/opencode/hera.json` on first load:

```json
{
  "disabled_agents": [],
  "disabled_skills": [],
  "agent_overrides": {
    "architect": { "model": "cherry/glm-5.1", "temperature": 0.3 }
  },
  "auto_evolve": false,
  "memory_limit": 1000,
  "team_defaults": { "coordination": "parallel", "timeout": 300000 }
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `bun: command not found` | Use the npm path: `npm install --prefix ~/.config/opencode hera-agent` |
| `npm: command not found` | Install Node.js LTS, then retry Option A |
| `opencode: command not found` | Install from [opencode-ai/opencode](https://github.com/opencode-ai/opencode) |
| Hera not appearing | Restart OpenCode or run `opencode agent reload` |
| Agent says "not found" | Create with `mode: "all"`, not `mode: "subagent"` |
| `fetch() cannot be empty string` | Upgrade to v2.0+ (zero network deps) |

## Documentation

- [Installation Guide](docs/INSTALLATION.md) - online/offline/internal networks
- [Installation Risk Matrix](docs/INSTALLATION_RISK_MATRIX.md) - install failure modes and plugin boundary
- [Installation Matrix](docs/INSTALLATION_MATRIX.md) - verified install smoke-test results
- [Canonical Demo](docs/CANONICAL_DEMO.md) - 2-minute walkthrough
- [Architecture](ARCHITECTURE.md) - deep dive
- [Changelog](CHANGELOG.md) - version history
- [Contributing](CONTRIBUTING.md) - how to contribute

## CLI Reference

```bash
hera doctor           # Health check
hera list agents      # List agents
hera list skills      # List skills
hera list teams       # List teams
hera create agent NAME --template coder  # Create agent
hera status           # System status
hera version          # Show version
```

See [Tool Reference](#tool-reference) for all 43 management tools.

---

## Tool Reference

<details>
<summary><strong>Agent Management</strong></summary>

- `hera_create_agent` - Create agent (optionally from template)
- `hera_list_agents` - List all created agents
- `hera_delete_agent` - Remove an agent (with backup)
- `hera_restore_agent` - Restore agent from backup
- `hera_spawn_agent` - Spawn agent as real OpenCode session
- `hera_verify_agent` - Verify agent registration
- `hera_export_agent` - Export agent as JSON
- `hera_import_agent` - Import agent from JSON
- `hera_quickstart` - Guided wizard for first-time setup

</details>

<details>
<summary><strong>Skill Management</strong></summary>

- `hera_create_skill` - Create a reusable skill
- `hera_list_skills` - List all skills
- `hera_delete_skill` - Delete a user-created skill
- `hera_upgrade_to_agent` - Upgrade skills into a full agent
- `hera_upgrade_to_team` - Upgrade skills into a coordinated agent team

</details>

<details>
<summary><strong>Team Management</strong></summary>

- `hera_create_team` - Create team with members and coordination mode
- `hera_upgrade_agents_to_team` - Convert existing agents into a team
- `hera_list_teams` - List all teams
- `hera_delete_team` - Remove a team
- `hera_spawn_team` - Launch team task
- `hera_team_message` - Send message between team members
- `hera_get_team_messages` - Read queued team messages for a member
- `hera_ack_team_messages` - Mark handled team messages as acknowledged
- `hera_team_remember` - Store team-scoped shared memory
- `hera_team_recall` - Search team-scoped shared memory
- `hera_quick_team` - Create team from template

</details>

<details>
<summary><strong>Memory & Evolution</strong></summary>

- `hera_remember` - Store information in persistent memory
- `hera_recall` - Search persistent memory
- `hera_evolve_agent` - Append evolution directive to agent
- `hera_list_evolutions` - View agent evolution history
- `hera_rollback_evolution` - Rollback latest evolution
- `hera_distill_session` - Extract knowledge from session

</details>

<details>
<summary><strong>System Management</strong></summary>

- `hera_status` - Show system status (agents, skills, teams, memory)
- `hera_onboard` - Re-run onboarding manually

</details>

<details>
<summary><strong>Workflow Templates</strong></summary>

| Template | Mode | Description |
|----------|------|-------------|
| coder-workflow | Serial | Analyze -> Implement -> Test -> Review -> Approve |
| reviewer-workflow | Parallel | Style + Security + Logic + Coverage checks |
| tester-workflow | Serial | Unit -> Integration -> E2E -> Report |
| documenter-workflow | Serial | Analyze -> Write -> Review -> Approve |
| team-workflow | DAG | Plan -> (Dev + Test + Docs) -> Review -> Approve |
| architect-workflow | Serial | Research -> Design -> Review -> Document -> Approve |
| debugger-workflow | Serial | Reproduce -> Analyze -> Fix -> Verify |
| optimizer-workflow | Serial | Profile -> Identify -> Optimize -> Benchmark -> Validate |
| researcher-workflow | Serial | Gather -> Analyze -> Synthesize -> Document |
| general-workflow | Serial | Analyze -> Execute -> Verify -> Report |

</details>

<details>
<summary><strong>Update / Uninstall</strong></summary>

**Update with npm**:
```bash
cd ~/.config/opencode && npm update hera-agent
# Restart OpenCode after update
```

**Update with Bun**:
```bash
cd ~/.config/opencode && bun update hera-agent
# Restart OpenCode after update
```

**Uninstall (keep data)**:
```bash
cd ~/.config/opencode && npm uninstall hera-agent
# Remove "hera-agent" from opencode.json plugin array if needed
```

**Full uninstall (remove everything; confirmation required)**:
```bash
hera uninstall --run --purge --yes
# or manually:
cd ~/.config/opencode && npm uninstall hera-agent
rm -rf ~/.config/opencode/hera-data/ ~/.config/opencode/agents/hera/ ~/.config/opencode/hera.json
```

</details>

## License

MIT

---

**Current Version**: v2.2.0 | **License**: MIT | **Status**: Production Ready
