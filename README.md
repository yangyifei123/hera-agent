# Hera — Agent Factory for OpenCode

> Named after the Greek goddess of creation. Hera creates agents, skills, and teams that self-evolve.

[![Version](https://img.shields.io/badge/version-2.2.0-blue.svg)](https://github.com/yangyifei123/hera-agent/releases/tag/v2.2.0)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-orange.svg)](https://github.com/opencode-ai/opencode)

Hera is an [OpenCode](https://github.com/opencode-ai/opencode) plugin that acts as an **agent factory**. It creates autonomous agents with persistent memory, distills conversations into reusable skills, and organizes agents into collaborative teams. Every agent inherits 8 built-in skills and can self-evolve over time. Both agents and teams can be exported as standalone OpenCode plugins.

## ✨ Features

- **Agent Factory** — Create agents from 10 templates or custom prompts
- **MD or Plugin Output** — Create agents as `.md` files (auto-discovered) or as standalone OpenCode plugins (auto-installable)
- **Team Plugin Export** — Export an entire team as one plugin (`hera_export_team`) registering all member agents at once
- **8 Built-in Skills** — caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact (inherited by every agent in both md and plugin form)
- **Skill → Agent Upgrade** — Promote one or more skills into a single full agent (`hera_upgrade_to_agent`)
- **Skill → Team Upgrade** — Promote N skills into N specialist agents + a coordinating team (`hera_upgrade_to_team`)
- **Agent Teams** — Parallel, sequential, or adaptive coordination with real OpenCode sessions
- **Team Management Modes** — Simple, OKR, hierarchy (tree), or control-point management
- **Self-Evolution** — Agents reflect on performance and append improvement directives
- **Persistent Memory** — JSON-based memory store, shared between Hera and every generated plugin
- **34 Management Tools** — Complete agent/skill/team lifecycle management
- **Session Distillation** — Extract structured knowledge from conversations
- **Auto-Memory** — Automatically extract insights from sessions
- **Semi-Auto Evolution** — Proposes improvements based on session analysis
- **Soft Delete + Backup** — Safe agent deletion with restore capability
- **Functional CLI** — `hera doctor`, `hera list[-agents|-skills|-templates|-teams]`, install/uninstall, version, help
- **First-Run Onboarding** — Automatic setup with default agents (quick-fixer, architect, senior-dev, qa-engineer) and `dev-team`
- **Zero-config plugin auto-install** — `auto_install=true` runs bun install/build/add end-to-end; no manual user steps

## 📦 Installation

### Windows Installation

```powershell
# 1. Install Bun (if not already installed)
powershell -c "irm bun.sh/install.ps1 | iex"

# 2. Navigate to OpenCode config directory
Set-Location "$env:USERPROFILE\.config\opencode"

# 3. Install hera-agent
bun add hera-agent

# 4. Verify installation
Get-Content "$env:USERPROFILE\.config\opencode\opencode.json" | Select-String "hera-agent"

# 5. Test
opencode agent list | Select-String "hera"
```

### Linux/macOS Installation

```bash
# 1. Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# 2. Navigate to OpenCode config directory
cd ~/.config/opencode

# 3. Install hera-agent
bun add hera-agent

# 4. Verify installation
cat ~/.config/opencode/opencode.json | grep hera-agent

# 5. Test
opencode agent list | grep hera
```

### Method 2: From GitHub Release (ZIP)

**If you downloaded the ZIP from GitHub Releases:**

```bash
# 1. Extract the ZIP
unzip hera-agent-2.0.0.zip
cd hera-agent-2.0.0

# 2. Install dependencies and build (if dist/ is missing)
bun install
bun run build

# 3. Install to OpenCode
cd ~/.config/opencode
bun add file:///path/to/hera-agent-2.0.0

# Example on Windows:
# bun add file:///E:/Downloads/hera-agent-2.0.0

# Example on Linux/Mac:
# bun add file:///home/user/Downloads/hera-agent-2.0.0
```

### Method 3: From Source (Development)

```bash
# 1. Clone the repository
git clone https://github.com/yangyifei123/hera-agent.git
cd hera-agent

# 2. Install dependencies
bun install

# 3. Build
bun run build

# 4. Link for development
cd ~/.config/opencode
bun add file:///path/to/hera-agent
```

### Verify Installation

After installation, verify `opencode.json` contains:

```json
{
  "plugin": [
    "hera-agent"
  ]
}
```

Then run the built-in diagnostic:

```bash
# Quick health check
hera doctor

# Should output:
# ✓ opencode.json found
# ✓ hera-agent in plugin list
# ✓ dist/index.js exists
# ✓ hera.json configured
# ✓ All systems operational
```

Or test manually:

```bash
# Check if Hera is loaded
opencode agent list | grep hera

# Should show:
# hera (primary)

# Start Hera
opencode --agent hera
```

**That's it!** Hera will automatically create `~/.config/opencode/hera.json` on first load.

## 🚀 Quick Start

After installation, verify core functionality with these quick tests:

### 1. Basic Agent Test

```bash
# Start Hera and ask a simple question
opencode --agent hera

# In the chat:
> "What is your name and version?"
# Expected: Hera should respond with its name and current version
```

### 2. Skill System Test

```bash
# List available skills
hera skill list

# Expected output:
# Built-in Skills:
#   - code-review
#   - debug-assistant
#   - test-generator
#   ...
```

### 3. Team Collaboration Test

```bash
# Create a simple team
hera team create my-test-team

# Add Hera to the team
hera team add my-test-team hera

# List teams
hera team list

# Expected: Should show my-test-team with hera as member
```

### 4. Health Check

```bash
# Run comprehensive diagnostic
hera doctor

# Expected output:
# ✓ opencode.json found
# ✓ hera-agent in plugin list
# ✓ dist/index.js exists
# ✓ hera.json configured
# ✓ All systems operational
```

### 5. Quick Functionality Checklist

- [ ] Agent responds to basic questions
- [ ] `hera skill list` shows built-in skills
- [ ] `hera team create` works without errors
- [ ] `hera doctor` reports all systems operational
- [ ] No error messages in OpenCode console

If all checks pass, you're ready to use Hera in production.

### Troubleshooting Installation

| Problem | Solution |
|---------|----------|
| **Windows: PowerShell path issues** | Use `cmd /c` workaround: `cmd /c "cd %USERPROFILE%\.config\opencode && bun add hera-agent"` |
| **Linux: Permission denied** | `chmod -R 755 ~/.config/opencode/node_modules/hera-agent/` |
| **Bun not installed** | Windows: `powershell -c "irm bun.sh/install.ps1 \| iex"` · Linux/macOS: `curl -fsSL https://bun.sh/install \| bash` |
| **General diagnosis** | Run `hera doctor` for automatic health check |

## 🔄 Update / Upgrade

### Update from npm

```bash
# Quick update
cd ~/.config/opencode
bun update hera-agent

# Or force reinstall latest
bun remove hera-agent && bun add hera-agent@latest
```

### Update from local source

```bash
# 1. Update source
cd /path/to/hera-agent
git pull origin master  # if from git
# or extract new ZIP

# 2. Rebuild
bun install
bun run build

# 3. Reinstall
cd ~/.config/opencode
bun remove hera-agent
bun add file:///path/to/hera-agent
```

### Check versions

```bash
# Current installed version
hera version

# Latest available version
npm view hera-agent version

# Or use CLI helper
hera update
```

**After update**: Restart OpenCode to load the new version.

## 🗑️ Uninstallation

### Complete Uninstall

```bash
# 1. Remove from opencode.json
# Edit ~/.config/opencode/opencode.json and remove "hera-agent" from plugin array

# 2. Remove the package
cd ~/.config/opencode
bun remove hera-agent

# 3. (Optional) Remove all Hera data
rm -rf ~/.config/opencode/hera-data/
rm -rf ~/.config/opencode/agents/hera/
rm -f ~/.config/opencode/hera.json
```

### Keep Data (Reinstall Later)

If you want to keep your agents, skills, and memory:

```bash
# Only remove the package
cd ~/.config/opencode
bun remove hera-agent

# Data remains in:
# - ~/.config/opencode/hera-data/      (memory, skills)
# - ~/.config/opencode/agents/hera/    (agent definitions)
# - ~/.config/opencode/hera.json       (configuration)
```

## 🚀 Quick Start

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

### 5-Minute Quick Verification

Verify Hera works correctly:

```bash
# 1. Create a test agent
opencode run --agent hera "创建 test-agent，mode: all，template: coder"

# 2. Use the agent
opencode run --agent test-agent "创建一个 hello.js 文件，输出 Hello World"

# 3. Verify the result
cat hello.js && node hello.js

# Should output: Hello World
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

## Architecture

```
hera-agent/
├── src/
│   ├── index.ts              # Plugin entry
│   ├── cli.ts                # CLI interface
│   ├── onboarding.ts         # First-run setup
│   ├── constants.ts          # Extracted constants
│   ├── helpers.ts            # Shared utilities
│   ├── persistence.ts        # Unified persistence
│   ├── logger.ts             # Debug logging
│   ├── validation.ts         # Name validation
│   ├── types.ts              # Core types
│   ├── types/
│   │   └── client.ts         # OpenCode client types
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
│   │   ├── index.ts          # Tool registration
│   │   ├── agent-tools.ts    # Agent domain
│   │   ├── skill-tools.ts    # Skill domain
│   │   ├── team-tools.ts     # Team domain
│   │   ├── memory-tools.ts   # Memory domain
│   │   ├── evolution-tools.ts # Evolution domain
│   │   └── system-tools.ts   # System domain
│   ├── team/
│   │   ├── manager.ts        # Team coordination
│   │   └── templates.ts      # Pre-defined templates
│   ├── memory/
│   │   ├── store.ts          # JSON persistence
│   │   └── smart-extractor.ts # Auto-memory extraction
│   └── distillation/
│       ├── engine.ts         # Knowledge extraction
│       └── auto-evolve.ts    # Semi-automatic evolution
├── bin/hera.js               # CLI entry
├── dist/                     # Build output
├── package.json
├── README.md
├── CLAUDE.md
└── ARCHITECTURE.md
```

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
