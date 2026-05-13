# Hera — Agent Factory for OpenCode

> Named after the Greek goddess of creation. Hera creates agents, skills, and teams that self-evolve.

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/yangyifei123/hera-agent/releases/tag/v2.0.0)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-orange.svg)](https://github.com/opencode-ai/opencode)

Hera is an [OpenCode](https://github.com/opencode-ai/opencode) plugin that acts as an **agent factory**. It creates autonomous agents with persistent memory, distills conversations into reusable skills, and organizes agents into collaborative teams. Every agent inherits 5 built-in skills and can self-evolve over time.

## ✨ Features

- **Agent Factory** — Create agents from 10 templates or custom prompts
- **Zero-Config Setup** — Auto-creates configuration on first load
- **5 Built-in Skills** — caveman, init, skill-combo, memory, evolution (inherited by all agents)
- **Skill → Agent Upgrade** — Promote one or more skills into a full agent
- **Agent Teams** — Parallel, sequential, or adaptive coordination with real OpenCode sessions
- **Self-Evolution** — Agents reflect on performance and append improvement directives
- **Persistent Memory** — JSON-based memory that survives restarts
- **25+ Management Tools** — Complete agent/skill/team lifecycle management
- **Session Distillation** — Extract structured knowledge from conversations

## Installation

```bash
# Using OpenCode plugin command (recommended)
opencode plugin hera-agent --global -f

# Or manually
cd ~/.config/opencode
bun add hera-agent
```

Then verify `opencode.json` contains:

```json
{
  "plugin": [
    "oh-my-openagent",
    "hera-agent"
  ]
}
```

**That's it!** Hera will automatically create `~/.config/opencode/hera.json` on first load.

## Quick Start

```bash
# Start Hera
opencode --agent hera

# Or run a single command
opencode run --agent hera "创建一个名为 my-coder 的编码专家 agent"

# Use a created agent (if mode is 'all' or 'primary')
opencode --agent my-coder "帮我写一个排序算法"

# Use a subagent via @mention
opencode run "请 @code-guardian 审查这段代码"
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
| **architect** | all | System architect with skill-combo |
| **debugger** | all | Debug specialist |
| **tester** | subagent | Test engineer |
| **documenter** | subagent | Documentation specialist |
| **optimizer** | subagent | Performance optimizer |

> **New in v2.0**: 5 additional templates (architect, debugger, tester, documenter, optimizer)

## Tool Reference

### Agent Management
- `hera_create_agent` — Create agent (optionally from template)
- `hera_list_agents` — List all created agents
- `hera_delete_agent` — Remove an agent
- `hera_spawn_agent` — Spawn agent as real OpenCode session
- `hera_verify_agent` — Verify agent registration
- `hera_export_agent` — Export agent as JSON
- `hera_import_agent` — Import agent from JSON

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

### System Management
- `hera_status` — Show system status (agents, skills, teams, memory)

## Configuration

Hera automatically creates `~/.config/opencode/hera.json` on first load. Edit it to customize:

### Configuration Options

```json
{
  "$schema": "https://raw.githubusercontent.com/yangyifei123/hera-agent/master/hera.schema.json",
  "default_model": "cherry/GLM-5",
  "disabled_agents": [],
  "disabled_skills": [],
  "disabled_tools": [],
  "agent_overrides": {
    "architect": {
      "model": "cherry/glm-5.1",
      "temperature": 0.3,
      "maxSteps": 50
    }
  },
  "templates": {
    "custom-analyst": {
      "label": "Data Analyst",
      "description": "Analyzes data and generates insights",
      "defaultMode": "subagent",
      "defaultSkills": ["caveman", "init", "memory", "evolution"],
      "prompt": "You are a data analyst..."
    }
  },
  "auto_evolve": false,
  "memory_limit": 1000,
  "team_defaults": {
    "coordination": "parallel",
    "timeout": 300000
  }
}
```

### Legacy Configuration (opencode.json)

You can also configure via plugin options in `opencode.json`:

```json
{
  "plugin": [
    ["hera-agent", {
      "default_model": "cherry/GLM-5",
      "disabled_agents": [],
      "disabled_skills": [],
      "disabled_tools": []
    }]
  ]
}
```

**Note**: `hera.json` takes precedence over `opencode.json` plugin options.

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

---

## 📚 Documentation

- [CHANGELOG.md](CHANGELOG.md) - Version history and release notes
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development setup and contribution guidelines
- [CLAUDE.md](CLAUDE.md) - Development documentation for Claude Code
- [TEST_REPORT.md](TEST_REPORT.md) - Comprehensive test coverage report
- [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md) - Technical architecture deep-dive

## 🔗 Links

- **GitHub**: https://github.com/yangyifei123/hera-agent
- **Issues**: https://github.com/yangyifei123/hera-agent/issues
- **Releases**: https://github.com/yangyifei123/hera-agent/releases

## 🙏 Acknowledgments

Thanks to the [OpenCode](https://github.com/opencode-ai/opencode) team for the excellent plugin system.

---

**Current Version**: v2.0.0 | **License**: MIT | **Status**: Production Ready ✅
