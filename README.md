# Hera — Agent Factory for OpenCode

> Named after the Greek goddess of creation and sovereignty. Hera's purpose is to **create agents**.

Hera is an [OpenCode](https://github.com/opencode-ai/opencode) plugin that acts as an **agent factory**. It creates autonomous agents with persistent memory, distills conversations into reusable skills, and organizes agents into collaborative teams. Every agent Hera creates inherits the built-in Caveman skill — an ultra-compressed communication mode that cuts token usage by ~75%.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Code Logic](#code-logic)
- [Tool Reference](#tool-reference)
- [Innovation Points](#innovation-points)
- [Configuration](#configuration)
- [Uninstall](#uninstall)

---

## Features

| Feature | Description |
|---------|-------------|
| **Agent Factory** | Create agents with custom prompts, skills, models, and permission modes |
| **Persistent Memory** | Every agent and Hera itself has a JSON-based memory system that survives restarts |
| **Session Distillation** | Extract structured knowledge (decisions, patterns, skills) from conversations |
| **Skill System** | Create, compose, and manage reusable behavior modules |
| **Skill → Agent Upgrade** | Promote one or more skills into a fully autonomous agent |
| **Agent Teams** | Organize agents into parallel, sequential, or adaptive teams with inter-member messaging |
| **Caveman Mode** | Built-in ultra-compressed communication (6 intensity levels), active by default in all agents |
| **Easy Install/Uninstall** | One-line install via bun, one config entry to activate |

---

## Installation

### Prerequisites

- [OpenCode](https://github.com/opencode-ai/opencode) installed and configured
- [Bun](https://bun.sh) runtime

### Step 1: Install the package

```bash
cd ~/.config/opencode
bun add /path/to/hera-agent
```

Or if published to npm:

```bash
cd ~/.config/opencode
bun add hera-agent
```

### Step 2: Activate the plugin

Edit `~/.config/opencode/opencode.json`, add `"hera-agent"` to the `plugin` array:

```json
{
  "plugin": [
    "hera-agent"
  ]
}
```

Can coexist with other plugins like `oh-my-openagent`:

```json
{
  "plugin": [
    "oh-my-openagent",
    "hera-agent"
  ]
}
```

### Step 3: Launch

```bash
opencode --agent hera
```

---

## Quick Start

Once inside the Hera session, you can:

```
> Create an agent called "code-reviewer" that reviews code for security issues

> Create a skill called "security-audit" that checks OWASP top 10

> Upgrade the "security-audit" skill into a full agent called "security-scanner"

> Create a team called "review-squad" with code-reviewer and security-scanner, working in parallel

> Remember that we use React 19 with server components
```

Hera will use its tools (`hera_create_agent`, `hera_create_skill`, `hera_upgrade_to_agent`, `hera_create_team`, `hera_remember`) to execute these commands. All created agents and skills persist across sessions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Runtime                       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Hera Plugin (entry)                  │   │
│  │                                                    │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────┐ │   │
│  │  │  MemoryStore │  │ SkillManager │  │  Team    │ │   │
│  │  │  (JSON fs)   │  │              │  │ Manager  │ │   │
│  │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │   │
│  │         │                 │                │       │   │
│  │  ┌──────┴─────────────────┴────────────────┴─────┐ │   │
│  │  │           DistillationEngine                  │ │   │
│  │  └───────────────────────────────────────────────┘ │   │
│  │                                                    │   │
│  │  ┌───────────────────────────────────────────────┐ │   │
│  │  │           13 Custom Tools                     │ │   │
│  │  │  hera_create_agent   hera_list_agents         │ │   │
│  │  │  hera_delete_agent   hera_create_skill        │ │   │
│  │  │  hera_list_skills    hera_delete_skill        │ │   │
│  │  │  hera_upgrade_to_agent                       │ │   │
│  │  │  hera_create_team    hera_list_teams          │ │   │
│  │  │  hera_team_message   hera_remember            │ │   │
│  │  │  hera_recall         hera_distill_session     │ │   │
│  │  └───────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Hera    │  │ Agent A  │  │ Agent B  │  ← created   │
│  │ (primary)│  │(subagent)│  │(subagent)│    agents    │
│  └──────────┘  └──────────┘  └──────────┘              │
│       │              │             │                     │
│       └──────────────┴─────────────┘                    │
│              Team "squad" (parallel)                     │
└─────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **Plugin Entry** | `src/index.ts` | ~85 | Assembles all subsystems, exports OpenCode Plugin hooks |
| **Types** | `src/types.ts` | ~70 | All TypeScript interfaces and type aliases |
| **Hera Agent** | `src/agents/hera.ts` | ~113 | Creates the Hera primary agent and child agent factory |
| **Memory Store** | `src/memory/store.ts` | ~78 | JSON file-based persistent storage with CRUD and search |
| **Caveman Skill** | `src/skills/caveman.ts` | ~53 | Built-in ultra-compressed communication skill definition |
| **Skill Manager** | `src/skills/manager.ts` | ~117 | Create, delete, list skills; upgrade skills to agents |
| **Team Manager** | `src/team/manager.ts` | ~149 | Team creation, member messaging, execution ordering |
| **Distillation** | `src/distillation/engine.ts` | ~140 | Extract knowledge from sessions into structured skills |
| **Tools** | `src/tools/hera-tools.ts` | ~358 | All 13 custom OpenCode tools using `@opencode-ai/plugin` |
| **Total** | | **~1008** | |

---

## Code Logic

### 1. Plugin Lifecycle (`src/index.ts`)

Hera follows the `@opencode-ai/plugin` contract. When OpenCode loads the plugin:

```
Plugin(input, options) → Hooks
```

The plugin function:
1. Initializes four subsystems: `MemoryStore`, `SkillManager`, `TeamManager`, `DistillationEngine`
2. Loads previously created agents from persistent memory (`.hera/hera-memory/agents/`)
3. Registers 13 custom tools via the `tool` hook
4. Returns a `Hooks` object with four hooks: `config`, `tool`, `experimental.chat.system.transform`, `experimental.session.compacting`

### 2. Config Hook — Dynamic Agent Registration

The `config` hook is called when OpenCode builds its configuration. Hera:
1. Reads the current model from config
2. Constructs the Hera primary agent with `createHeraAgent(model, skills)`
3. Iterates over all registered child agents from memory
4. For each child agent, resolves its skills via `SkillManager.getSkill()`
5. Constructs a full `AgentConfig` with `createChildAgent()` and injects it into the config

This means agents created in previous sessions are automatically re-registered.

### 3. Memory System (`src/memory/store.ts`)

```
.hera/hera-memory/
├── sessions/      # Session transcripts and context
├── skills/        # Skill definitions (built-in + user-created)
├── agents/        # Agent definitions (persisted across restarts)
├── teams/         # Team configurations
└── distillations/ # Distilled session knowledge
```

Each memory entry is a JSON file with: `id`, `type`, `content`, `timestamp`, `metadata`.

Key operations: `save()`, `load()`, `list()`, `delete()`, `search()`.

### 4. Skill System (`src/skills/manager.ts` + `src/skills/caveman.ts`)

Skills are modular behavior definitions with:
- `name` — identifier
- `description` — what it does
- `trigger` — when to activate
- `prompt` — the instruction text injected into agent system prompts

The Caveman skill is auto-embedded in every agent Hera creates. It supports 6 intensity levels:
- `lite` — professional but tight
- `full` — classic caveman, fragments OK
- `ultra` — extreme abbreviation, arrows for causality
- `wenyan-lite` / `wenyan-full` / `wenyan-ultra` — classical Chinese terseness

Skills can also be written to the `skills/` directory in OpenCode SKILL.md format for discovery by other plugins.

### 5. Skill → Agent Upgrade (`hera_upgrade_to_agent`)

The upgrade flow:
1. Takes an array of skill names and an agent name
2. Calls `SkillManager.upgradeSkillsToAgentPrompt()` which concatenates all skill prompts
3. Wraps them in an agent identity prompt with directives
4. Saves as a new `AgentDefinition` in memory
5. The next time the `config` hook fires, the new agent is registered with OpenCode

### 6. Team System (`src/team/manager.ts`)

Teams coordinate multiple agents through three modes:

| Mode | Execution Order |
|------|----------------|
| `parallel` | All members run simultaneously |
| `sequential` | Members run one after another |
| `adaptive` | First member runs alone, then remaining members run in parallel |

Inter-member communication uses a message queue with `broadcast` support. Messages have types: `message`, `task`, `result`, `shutdown_request`.

### 7. Distillation (`src/distillation/engine.ts`)

Session distillation extracts structured knowledge:

```
Conversation → DistillationEngine → DistillationResult
                                        ├── summary
                                        ├── keyDecisions[]
                                        ├── patternsLearned[]
                                        └── skillsExtracted[]
```

The engine uses regex pattern matching to extract:
- **Decisions**: Phrases like "decided to", "chose", "will use"
- **Technical patterns**: Framework names, languages, architecture patterns
- **Summary**: Top assistant messages condensed

If a `skill_name` is provided, the distillation automatically creates a skill from the result.

### 8. System Prompt Injection (`experimental.chat.system.transform`)

When the Hera agent is active, this hook injects dynamic context:
- **Active Teams**: Team names, members, coordination mode
- **Registered Agents**: Names, descriptions, modes

This keeps Hera aware of its own creations within each conversation turn.

---

## Tool Reference

### Agent Management

| Tool | Description |
|------|-------------|
| `hera_create_agent` | Create agent with name, description, prompt, mode, optional model and skills |
| `hera_list_agents` | List all created agents with their configuration |
| `hera_delete_agent` | Remove an agent from registry and memory |

### Skill Management

| Tool | Description |
|------|-------------|
| `hera_create_skill` | Define a new reusable skill with name, description, trigger, and prompt |
| `hera_list_skills` | Show all available skills (built-in + user-created) |
| `hera_delete_skill` | Remove a user-created skill (built-ins protected) |
| `hera_upgrade_to_agent` | Promote one or more skills into a fully autonomous agent |

### Team Management

| Tool | Description |
|------|-------------|
| `hera_create_team` | Create team with members and coordination mode |
| `hera_list_teams` | Show all teams with members and configuration |
| `hera_team_message` | Send message between team members (supports broadcast) |

### Memory & Distillation

| Tool | Description |
|------|-------------|
| `hera_remember` | Store information in persistent memory with category |
| `hera_recall` | Search memory by query and optional category filter |
| `hera_distill_session` | Extract structured knowledge from a session, optionally auto-create a skill |

---

## Innovation Points

### 1. Agent-as-Factory Pattern

Unlike existing OpenCode plugins that provide a fixed set of agents, Hera is a **meta-agent** — its primary function is to create other agents. This is a level of indirection not seen in the current ecosystem. The user doesn't need to edit config files to add agents; they just tell Hera what they need.

### 2. Skill → Agent Upgrade Pipeline

Skills are first-class citizens that can be composed and promoted. A user can:
1. Create a skill from distilled knowledge
2. Test it in isolation
3. Combine multiple skills
4. Upgrade the combination into a full agent

This creates a progressive enhancement path: `Knowledge → Skill → Agent → Team`.

### 3. Persistent Agent Memory Across Sessions

Created agents are persisted to `.hera/hera-memory/` as JSON files. When OpenCode restarts, the `config` hook reloads all previously created agents. This means Hera's "creations" survive restarts — a form of agent persistence not typically available in plugin systems.

### 4. Multi-Mode Team Coordination

The team system supports three distinct coordination patterns:
- **Parallel** — All agents work simultaneously on independent subtasks
- **Sequential** — Chain of agents where each builds on previous output
- **Adaptive** — First agent plans, remaining agents execute in parallel

Inter-member messaging with broadcast enables collaboration beyond the simple parent-child subagent pattern.

### 5. Built-in Caveman Skill with 6 Intensity Levels

Every agent inherits the Caveman skill, which reduces token consumption by ~75%. The six intensity levels (including three classical Chinese modes) are novel in the OpenCode ecosystem. This makes Hera-created agents significantly more cost-efficient at scale.

### 6. Session Distillation as Knowledge Capture

The distillation engine transforms ephemeral conversations into structured, reusable knowledge. A completed debugging session becomes a skill. An architecture discussion becomes a decision record. This creates a learning loop where each session makes future sessions more efficient.

### 7. Zero-Config Dynamic Registration

Hera doesn't require manual agent registration in `opencode.json`. The `config` hook dynamically injects all created agents into OpenCode's agent registry. The `experimental.chat.system.transform` hook injects team and agent awareness into the system prompt at runtime. Everything is self-organizing.

---

## Configuration

Hera accepts optional plugin configuration in `opencode.json`:

```json
{
  "plugin": [
    ["hera-agent", {
      "default_model": "cherry/GLM-5",
      "disabled_skills": [],
      "disabled_agents": [],
      "disabled_tools": [],
      "memory_dir": ".hera"
    }]
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `default_model` | `string` | Inherited from opencode | Default model for Hera and child agents |
| `disabled_skills` | `string[]` | `[]` | Skills to disable (caveman cannot be disabled) |
| `disabled_agents` | `string[]` | `[]` | Agent names to exclude |
| `disabled_tools` | `string[]` | `[]` | Tool names to exclude |
| `memory_dir` | `string` | `.hera` | Directory for persistent memory storage |

---

## Uninstall

```bash
# 1. Remove from opencode.json
# Edit ~/.config/opencode/opencode.json and remove "hera-agent" from the plugin array

# 2. Remove the package
cd ~/.config/opencode
bun remove hera-agent

# 3. (Optional) Clean up persistent memory
rm -rf .hera/
```

---

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Build with TypeScript declarations
bunx tsc --emitDeclarationOnly

# Test (manual)
cd ~/.config/opencode
bun run /path/to/hera-agent/test.ts
```

### Build Output

The build produces a single ESM bundle (`dist/index.js`, ~31KB) with `@opencode-ai/plugin` and `@opencode-ai/sdk` as external dependencies. These are resolved from the host OpenCode environment at runtime.

---

## License

MIT
