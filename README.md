# Hera — Agent Factory for OpenCode

> Named after the Greek goddess of creation. Hera creates agents, skills, and teams that self-evolve.

Hera is an [OpenCode](https://github.com/opencode-ai/opencode) plugin that acts as an **agent factory**. It creates autonomous agents with persistent memory, distills conversations into reusable skills, and organizes agents into collaborative teams. Every agent inherits 5 built-in skills and can self-evolve over time.

## Features

- **Agent Factory** — Create agents from templates (general, coder, reviewer, researcher, coordinator) or custom prompts
- **5 Built-in Skills** — caveman, init, skill-combo, memory, evolution (inherited by all agents)
- **Skill → Agent Upgrade** — Promote one or more skills into a full agent
- **Agent Teams** — Parallel, sequential, or adaptive coordination with real OpenCode sessions
- **Self-Evolution** — Agents reflect on performance and append improvement directives
- **Persistent Memory** — JSON-based memory that survives restarts
- **Session Distillation** — Extract structured knowledge from conversations

## Installation

```bash
# Using OpenCode plugin command (recommended)
weq plugin E:/AI_field/hera-agent --global -f

# Or manually
cd ~/.config/opencode
bun add E:/AI_field/hera-agent
```

Then verify `opencode.json` contains:

```json
{
  "plugin": [
    "oh-my-openagent",
    "E:/AI_field/hera-agent"
  ]
}
```

## Quick Start

```bash
# Start Hera
weq --agent hera

# Or run a single command
weq run --agent hera "创建一个名为 my-coder 的编码专家 agent"

# Use a created agent
weq --agent my-coder "帮我写一个排序算法"
```

## Built-in Skills

| Skill | Description |
|-------|-------------|
| **caveman** | Ultra-compressed communication (~75% token savings) |
| **init** | Environment awareness — auto-detects project context |
| **skill-combo** | Dynamic skill composition for multi-domain tasks |
| **memory** | Autonomous memory management — remember/recall |
| **evolution** | Self-improvement through reflection and directive appending |

## Agent Templates

| Template | Mode | Description |
|----------|------|-------------|
| **general** | all | Versatile assistant for any task |
| **coder** | all | Coding expert with skill-combo |
| **reviewer** | subagent | Code review specialist |
| **researcher** | subagent | Research analyst with skill-combo |
| **coordinator** | all | Team coordinator with skill-combo |

## Tool Reference

### Agent Management
- `hera_create_agent` — Create agent (optionally from template)
- `hera_list_agents` — List all created agents
- `hera_delete_agent` — Remove an agent
- `hera_spawn_agent` — Spawn agent as real OpenCode session

### Skill Management
- `hera_create_skill` — Create a reusable skill
- `hera_list_skills` — List all skills
- `hera_delete_skill` — Delete a user-created skill
- `hera_upgrade_to_agent` — Upgrade skills into a full agent

### Team Management
- `hera_create_team` — Create team with members and coordination mode
- `hera_list_teams` — List all teams
- `hera_delete_team` — Remove a team
- `hera_spawn_team` — Launch team task
- `hera_team_message` — Send message between team members

### Memory & Evolution
- `hera_remember` — Store information in persistent memory
- `hera_recall` — Search persistent memory
- `hera_evolve_agent` — Append evolution directive to agent
- `hera_list_evolutions` — View agent evolution history
- `hera_rollback_evolution` — Rollback latest evolution
- `hera_distill_session` — Extract knowledge from session

## Configuration

```json
{
  "plugin": [
    ["E:/AI_field/hera-agent", {
      "default_model": "cherry/GLM-5",
      "disabled_agents": [],
      "disabled_skills": [],
      "disabled_tools": []
    }]
  ]
}
```

## Architecture

```
hera-agent/
├── src/
│   ├── index.ts              # Plugin entry
│   ├── types.ts              # Type definitions
│   ├── agents/
│   │   ├── hera.ts           # Hera agent + templates
│   │   └── registry.ts       # .md file persistence
│   ├── skills/
│   │   ├── caveman.ts        # Ultra-compressed communication
│   │   ├── init.ts           # Environment awareness
│   │   ├── skill-combo.ts    # Skill composition
│   │   ├── memory.ts         # Autonomous memory
│   │   ├── evolution.ts      # Self-improvement
│   │   └── manager.ts        # Skill CRUD
│   ├── tools/
│   │   ├── index.ts          # All tools (17+)
│   │   └── hera-tools.ts     # Backward compat entry
│   ├── team/
│   │   └── manager.ts        # Team coordination
│   ├── memory/
│   │   └── store.ts          # JSON persistence
│   └── distillation/
│       └── engine.ts         # Knowledge extraction
├── bin/hera.js               # CLI
├── package.json
└── README.md
```

## License

MIT
