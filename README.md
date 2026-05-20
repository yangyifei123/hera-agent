# Hera — Agent Factory for OpenCode

> Named after the Greek goddess of creation. Hera creates agents, skills, and teams that self-evolve.

[![Version](https://img.shields.io/badge/version-2.2.0-blue.svg)](https://github.com/yangyifei123/hera-agent/releases/tag/v2.2.0)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-orange.svg)](https://github.com/opencode-ai/opencode)

Hera is an [OpenCode](https://github.com/opencode-ai/opencode) plugin that acts as an **agent factory**. It creates autonomous agents with persistent memory, distills conversations into reusable skills, and organizes agents into collaborative teams. Every agent inherits 8 built-in skills and can self-evolve over time. Both agents and teams can be exported as standalone OpenCode plugins.

## ✨ Features

- **Agent Factory** — Create agents from 10 templates or custom prompts
- **Plugin Architecture** — Every generated agent is a standalone OpenCode plugin with full capabilities
- **Agent Packaging & Migration** — Package agents as .tar.gz files for easy distribution and migration across environments
- **8 Built-in Skills** — caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact (inherited by every agent)
- **Shared Memory Pool** — All agents (Hera + generated) share the same persistent memory store
- **MD or Plugin Output** — Create agents as `.md` files (auto-discovered) or as standalone plugins (auto-installable)
- **Team Plugin Export** — Export entire teams as single plugins registering all member agents at once
- **Skill → Agent Upgrade** — Promote skills into full agents (`hera_upgrade_to_agent`)
- **Skill → Team Upgrade** — Promote N skills into N specialist agents + coordinating team (`hera_upgrade_to_team`)
- **Agent Teams** — Parallel, sequential, or adaptive coordination with real OpenCode sessions
- **Team Management Modes** — Simple, OKR, hierarchy (tree), or control-point management
- **Self-Evolution** — Agents reflect on performance and append improvement directives
- **37 Management Tools** — Complete agent/skill/team lifecycle management + packaging
- **Session Distillation** — Extract structured knowledge from conversations
- **Auto-Memory** — Automatically extract insights from sessions
- **Semi-Auto Evolution** — Proposes improvements based on session analysis
- **Soft Delete + Backup** — Safe agent deletion with restore capability
- **Functional CLI** — `hera doctor`, `hera list[-agents|-skills|-templates|-teams]`, install/uninstall, version, help
- **First-Run Onboarding** — Automatic setup with default agents (quick-fixer, architect, senior-dev, qa-engineer) and `dev-team`
- **Zero-config Auto-install** — `auto_install=true` runs bun install/build/add end-to-end with no manual steps

## 📦 Installation

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- [OpenCode](https://github.com/opencode-ai/opencode) CLI

### One-Command Install

```bash
# Linux/macOS
cd ~/.config/opencode && bun add hera-agent

# Windows (PowerShell)
cd $env:USERPROFILE\.config\opencode; bun add hera-agent
```

### Verify Installation

```bash
# Run health check (recommended)
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor

# Or check agent list
opencode agent list | grep hera
# Expected: hera (primary)
```

**That's it!** Hera auto-configures on first load and creates 4 default agents (quick-fixer, architect, senior-dev, qa-engineer) plus a dev-team.

### Alternative: Install from Source

```bash
# Clone and build
git clone https://github.com/yangyifei123/hera-agent.git
cd hera-agent
bun install && bun run build

# Install to OpenCode
cd ~/.config/opencode
bun add file://$(pwd)/../hera-agent  # Linux/macOS
# bun add file:///E:/path/to/hera-agent  # Windows
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `bun: command not found` | Install Bun: `curl -fsSL https://bun.sh/install \| bash` (Linux/macOS) or `irm bun.sh/install.ps1 \| iex` (Windows) |
| `opencode: command not found` | Install OpenCode from [opencode-ai/opencode](https://github.com/opencode-ai/opencode) |
| Hera not showing in agent list | Restart OpenCode or run `opencode agent reload` |
| Permission errors (Linux) | `chmod -R 755 ~/.config/opencode/node_modules/hera-agent/` |

## 🚀 Quick Start

### Start Using Hera

```bash
# Interactive mode
opencode --agent hera

# Single command
opencode run --agent hera "create a coder agent named my-dev"

# Use a generated agent (if mode is 'all' or 'primary')
opencode --agent my-dev "write a fibonacci function"
```

### 5-Step Verification

```bash
# 1. Check Hera is loaded
opencode agent list | grep hera
# Expected: hera (primary)

# 2. Run health check
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
# Expected: All checks passed ✓

# 3. List built-in skills
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js list-skills
# Expected: 8 built-in skills (caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact)

# 4. Test agent creation
opencode run --agent hera "create test-agent, mode: all, template: coder"

# 5. Use the created agent
opencode --agent test-agent "echo 'Hello from Hera agent!'"
```

### Common Use Cases

```bash
# Create specialized agents
opencode run --agent hera "create a code-reviewer agent"
opencode run --agent hera "create a bug-hunter agent with debugging skills"

# Create teams
opencode run --agent hera "create review-team with code-reviewer and bug-hunter, mode: parallel"

# Export as plugins (for distribution)
opencode run --agent hera "export my-dev as plugin"
opencode run --agent hera "export review-team as team plugin"

# Package agents for migration
opencode run --agent hera "package my-dev agent for distribution"
opencode run --agent hera "package code-reviewer with memory included"

# Import packaged agents
opencode run --agent hera "unpack agent from /path/to/my-dev-package.tar.gz"

# Memory management
opencode run --agent hera "remember: our coding style uses 2-space indentation"
opencode run --agent hera "recall memories about coding style"
```

## 📦 Agent Packaging & Migration

Hera provides complete agent packaging for easy distribution and migration across environments.

### Package an Agent

```bash
# Package agent (plugin or .md mode)
opencode run --agent hera "package my-dev agent"

# Package with memory data
opencode run --agent hera "package my-dev agent with memory"

# Custom output name
opencode run --agent hera "package my-dev as my-custom-name"
```

**What gets packaged:**
- **Plugin mode**: Complete plugin code (dist/, package.json, INSTALL.md)
- **MD mode**: Agent .md definition file
- **Optional**: Related memory data from shared memory pool
- **Always**: Manifest with metadata and file list

**Output**: `.tar.gz` file in `~/.config/opencode/hera-data/packages/`

### Unpack an Agent

```bash
# Unpack and install
opencode run --agent hera "unpack agent from /path/to/package.tar.gz"

# Unpack without auto-install (plugin mode)
opencode run --agent hera "unpack /path/to/package.tar.gz without installing"
```

**What gets restored:**
- Agent plugin code or .md file
- Memory data (if included in package)
- All configuration and metadata

### List Packages

```bash
# List all packaged agents
opencode run --agent hera "list packages"
```

### Use Cases

**Scenario 1: Share agent with team**
```bash
# Developer A: Package agent
opencode run --agent hera "package code-reviewer with memory"
# Send: ~/.config/opencode/hera-data/packages/code-reviewer-package.tar.gz

# Developer B: Import agent
opencode run --agent hera "unpack agent from ~/Downloads/code-reviewer-package.tar.gz"
```

**Scenario 2: Migrate agents to new machine**
```bash
# Old machine: Package all important agents
opencode run --agent hera "package my-dev with memory"
opencode run --agent hera "package architect with memory"

# New machine: Restore agents
opencode run --agent hera "unpack agent from my-dev-package.tar.gz"
opencode run --agent hera "unpack agent from architect-package.tar.gz"
```

**Scenario 3: Backup before major changes**
```bash
# Create backup
opencode run --agent hera "package production-agent with memory as backup-2024-05-18"

# If needed, restore
opencode run --agent hera "unpack agent from backup-2024-05-18.tar.gz"
```

## 🔄 Update / Upgrade

```bash
# Update to latest version
cd ~/.config/opencode
bun update hera-agent

# Or force reinstall
bun remove hera-agent && bun add hera-agent@latest

# Check current version
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js version

# Check latest available
npm view hera-agent version
```

**After update**: Restart OpenCode to load the new version.

## 🗑️ Uninstallation

### Quick Uninstall (Keep Data)

```bash
# Remove package only (keeps agents, skills, memory)
cd ~/.config/opencode
bun remove hera-agent

# Remove from opencode.json plugin list
# Edit ~/.config/opencode/opencode.json and remove "hera-agent"
```

Your data remains in:
- `~/.config/opencode/hera-data/` (memory, skills, teams)
- `~/.config/opencode/agents/hera/` (agent definitions)
- `~/.config/opencode/hera.json` (configuration)

### Complete Uninstall (Remove Everything)

```bash
# 1. Remove package
cd ~/.config/opencode
bun remove hera-agent

# 2. Remove from opencode.json
# Edit ~/.config/opencode/opencode.json and remove "hera-agent" from plugin array

# 3. Remove all data
rm -rf ~/.config/opencode/hera-data/
rm -rf ~/.config/opencode/agents/hera/
rm -f ~/.config/opencode/hera.json

# Windows PowerShell:
# Remove-Item -Recurse -Force "$env:USERPROFILE\.config\opencode\hera-data"
# Remove-Item -Recurse -Force "$env:USERPROFILE\.config\opencode\agents\hera"
# Remove-Item -Force "$env:USERPROFILE\.config\opencode\hera.json"
```

### Backup Before Uninstall

```bash
# Backup your data
cd ~/.config/opencode
tar -czf hera-backup-$(date +%Y%m%d).tar.gz hera-data/ agents/hera/ hera.json

# Or on Windows:
# Compress-Archive -Path "$env:USERPROFILE\.config\opencode\hera-data","$env:USERPROFILE\.config\opencode\agents\hera","$env:USERPROFILE\.config\opencode\hera.json" -DestinationPath "hera-backup.zip"
```

## 🏗️ Architecture

### Plugin-Based Design

```
Hera (OpenCode Plugin)
├── Generates → Agent Plugins (standalone, full capabilities)
│   ├── Inherits: 8 built-in skills
│   ├── Shares: Memory pool with Hera
│   └── Tools: hera_remember, hera_recall (built-in)
├── Generates → Team Plugins (multi-agent coordination)
└── Exports → Distributable packages
```

**Key Points:**
- Hera itself is an OpenCode plugin
- Every generated agent is also a standalone OpenCode plugin
- All agents share the same memory store (`~/.config/opencode/hera-data/memory/`)
- Generated agents have full capabilities: memory, evolution, skill-combo, subagent, etc.
- Teams can be exported as single plugins containing all member agents

### Built-in Skills (Inherited by All Agents)

| Skill | Description | Capability |
|-------|-------------|------------|
| **caveman** | Ultra-compressed communication | ~75% token savings |
| **init** | Environment awareness | Auto-detects project context |
| **memory** | Persistent memory management | Shared JSON store with tools |
| **evolution** | Self-improvement through reflection | Appends directives after sessions |
| **skill-combo** | Dynamic skill composition | Combines multiple skills on-the-fly |
| **subagent** | Delegate to specialized agents | Spawns focused sub-tasks |
| **communicate** | Team coordination | Message passing between agents |
| **auto-compact** | Context window discipline | Automatic conversation compression |

All 8 skills are embedded in every generated agent's prompt and are fully functional.
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
- `hera_delete_agent` — Remove an agent (with backup)
- `hera_restore_agent` — Restore agent from backup
- `hera_spawn_agent` — Spawn agent as real OpenCode session
- `hera_verify_agent` — Verify agent registration
- `hera_export_agent` — Export agent as JSON
- `hera_import_agent` — Import agent from JSON
- `hera_quickstart` — Guided wizard for first-time setup

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
- `hera_quick_team` — Create team from template

### Memory & Evolution
- `hera_remember` — Store information in persistent memory
- `hera_recall` — Search persistent memory
- `hera_evolve_agent` — Append evolution directive to agent
- `hera_list_evolutions` — View agent evolution history
- `hera_rollback_evolution` — Rollback latest evolution
- `hera_distill_session` — Extract knowledge from session

### System Management
- `hera_status` — Show system status (agents, skills, teams, memory)
- `hera_onboard` — Re-run onboarding manually

## Configuration

Hera automatically creates `~/.config/opencode/hera.json` on first load. Edit it to customize:

### Configuration Options

```json
{
  "$schema": "./hera.schema.json",
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
      "disabled_agents": [],
      "disabled_skills": [],
      "disabled_tools": []
    }]
  ]
}
```

**Note**: `hera.json` takes precedence over `opencode.json` plugin options.

## CLI Usage

Hera provides a functional CLI for all operations:

```bash
# List all agents
hera list agents

# Create an agent
hera create agent my-coder --template coder

# Delete an agent (with backup)
hera delete agent my-coder

# Restore from backup
hera restore agent my-coder

# List teams
hera list teams

# Show system status
hera status

# Get help
hera --help
```

## 📂 File Structure

```
hera-agent/
├── src/
│   ├── index.ts              # Plugin entry + config hook
│   ├── agents/
│   │   ├── hera.ts           # Hera agent + 10 templates + buildAgentPrompt
│   │   └── registry.ts       # .md file persistence
│   ├── skills/               # 8 built-in skills (inherited by all agents)
│   │   ├── caveman.ts        # Ultra-compressed communication
│   │   ├── init.ts           # Environment awareness
│   │   ├── memory.ts         # Persistent memory with tools
│   │   ├── evolution.ts      # Self-improvement reflection
│   │   ├── skill-combo.ts    # Dynamic skill composition
│   │   ├── subagent.ts       # Delegate to specialists
│   │   ├── communicate.ts    # Team coordination
│   │   ├── auto-compact.ts   # Context window management
│   │   └── manager.ts        # Skill CRUD operations
│   ├── tools/                # 34 management tools
│   │   ├── agent-tools.ts    # Agent lifecycle (create, delete, export)
│   │   ├── skill-tools.ts    # Skill management
│   │   ├── team-tools.ts     # Team coordination
│   │   ├── memory-tools.ts   # Memory operations
│   │   ├── evolution-tools.ts # Evolution management
│   │   └── system-tools.ts   # System utilities
│   ├── generators/
│   │   └── plugin-generator.ts # Generates standalone agent plugins
│   ├── team/
│   │   ├── manager.ts        # Team execution (parallel/sequential/adaptive)
│   │   └── control-manager.ts # Team management modes
│   ├── memory/
│   │   ├── store.ts          # Shared JSON memory store
│   │   └── smart-extractor.ts # Auto-memory extraction
│   └── distillation/
│       ├── engine.ts         # Session knowledge extraction
│       └── auto-evolve.ts    # Semi-automatic evolution
├── bin/hera.js               # CLI entry (doctor, list-*, version, help)
├── dist/                     # Build output
└── tests/                    # 438 tests, 90.73% coverage
```

**Data Directories** (created at `~/.config/opencode/`):
- `hera-data/memory/` — Shared memory pool (all agents)
- `hera-data/skills/` — User-defined skills
- `hera-data/teams/` — Team configurations
- `agents/hera/` — Agent definitions (.md files)
- `hera.json` — Hera configuration

For detailed architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Troubleshooting

### Issue: "agent not found"

**Check 1**: Verify Hera is in opencode.json:
```bash
cat ~/.config/opencode/opencode.json | grep hera-agent
```

**Check 2**: Verify installation:
```bash
ls ~/.config/opencode/node_modules/hera-agent/dist/index.js
```

**Check 3**: Restart OpenCode:
```bash
# OpenCode should auto-detect the plugin on next start
opencode --agent hera
```

### Issue: "fetch() cannot be empty string" (v1.x only)

**Solution**: Upgrade to v2.0.0+:
```bash
cd ~/.config/opencode
bun remove hera-agent
bun add hera-agent@latest
```

v2.0.0+ has zero network dependencies and works in internal networks.

### Issue: Created agent doesn't work

**Check mode**: Subagents can't be called with `--agent`:
```bash
# ❌ Wrong (if agent is subagent mode)
opencode --agent my-subagent

# ✅ Correct
opencode run "请 @my-subagent 帮我..."
```

**Solution**: Create agents with `mode: "all"` for direct `--agent` usage:
```bash
opencode run --agent hera "创建 my-agent，mode: all，template: coder"
```

## License

MIT

---

## 📚 Documentation

- [INSTALLATION.md](docs/INSTALLATION.md) - Detailed installation guide (online/offline/internal networks)
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

**Current Version**: v2.2.0 | **License**: MIT | **Status**: Production Ready ✅
