# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hera is an OpenCode plugin that acts as an **agent factory**. It creates autonomous agents with persistent memory, distills conversations into reusable skills, and organizes agents into collaborative teams. Named after the Greek goddess of creation, Hera enables dynamic agent creation and self-evolution.

**Key Concept**: Agents are persisted as `.md` files in `~/.config/opencode/agents/hera/` with YAML frontmatter. OpenCode discovers them automatically on startup by scanning this directory.

## Build & Development

```bash
# Build the plugin
bun run build

# Watch mode for development
bun run dev

# The build outputs to dist/ and is configured for Bun runtime
# External dependencies: @opencode-ai/plugin, @opencode-ai/sdk
```

## Installation & Testing

```bash
# Install as OpenCode plugin (recommended)
opencode plugin hera-agent --global -f

# Or manually
cd ~/.config/opencode
bun add hera-agent

# Verify installation
opencode list agent  # Should show 'hera' in the list

# Start Hera
opencode --agent hera
```

## Architecture

### Core Systems

1. **Agent Registry** (`src/agents/registry.ts`)
   - Writes agent definitions as `.md` files to `~/.config/opencode/agents/hera/`
   - Parses YAML frontmatter + markdown body
   - Handles evolution directive injection
   - Key method: `register()` - creates the .md file that OpenCode discovers

2. **Memory Store** (`src/memory/store.ts`)
   - JSON-based persistent storage in `~/.config/opencode/hera-data/memory/`
   - Categories: session, skill, agent, team, distillation
   - Survives restarts

3. **Skill Manager** (`src/skills/manager.ts`)
   - Manages 5 built-in skills (caveman, init, skill-combo, memory, evolution)
   - User-created skills stored in `~/.config/opencode/hera-data/skills/`
   - Skills can be upgraded to full agents

4. **Team Manager** (`src/team/manager.ts`)
   - Creates real OpenCode sessions via `client.session.create()`
   - Coordination modes: parallel, sequential, adaptive
   - Each team member runs in an independent session

5. **Distillation Engine** (`src/distillation/engine.ts`)
   - Extracts structured knowledge from conversations
   - Can auto-create skills from distilled patterns

### Plugin Lifecycle

The plugin entry point (`src/index.ts`) returns hooks:

- **`config` hook**: Injects Hera + all created agents into OpenCode's agent registry at startup
- **`tool` hook**: Registers 17+ tools (hera_create_agent, hera_spawn_team, etc.)
- **`experimental.chat.system.transform`**: Injects active teams/agents/skills into system prompt
- **`experimental.session.compacting`**: Adds distillation context before compaction

### Agent Creation Flow

```
User: "Create agent named sentinel"
  ↓
hera_create_agent tool called
  ↓
AgentRegistry.register() writes:
  ~/.config/opencode/agents/hera/sentinel.md
  (with YAML frontmatter + prompt + skills)
  ↓
registeredAgents.set("sentinel", def)
  ↓
config hook injects sentinel into input.agent
  ↓
Result: sentinel immediately available via @sentinel
```

### Directory Structure

```
~/.config/opencode/
├── agents/hera/          ← Agent .md files (auto-discovered by OpenCode)
├── hera-data/
│   ├── memory/           ← JSON memory store
│   └── skills/           ← User-created skill definitions
```

## Built-in Skills

All agents inherit these 5 skills:

1. **caveman** - Ultra-compressed communication (~75% token savings), 6 intensity levels
2. **init** - Environment awareness, auto-detects project context
3. **skill-combo** - Dynamic skill composition for multi-domain tasks
4. **memory** - Autonomous memory management (remember/recall)
5. **evolution** - Self-improvement through reflection and directive appending

## Agent Templates

10 templates available via `hera_create_agent`:

- **general** (mode: all) - Versatile assistant
- **coder** (mode: all) - Coding expert with skill-combo
- **reviewer** (mode: subagent) - Code review specialist
- **researcher** (mode: subagent) - Research analyst with skill-combo
- **coordinator** (mode: all) - Team coordinator with skill-combo
- **architect** (mode: all) - System architect with skill-combo
- **debugger** (mode: all) - Debug specialist
- **tester** (mode: subagent) - Test engineer
- **documenter** (mode: subagent) - Documentation specialist
- **optimizer** (mode: subagent) - Performance optimizer

## Key Tools

### Agent Management
- `hera_create_agent` - Create agent (optionally from template)
- `hera_list_agents` - List all created agents
- `hera_delete_agent` - Remove an agent
- `hera_spawn_agent` - Spawn agent as real OpenCode session

### Skill Management
- `hera_create_skill` - Create a reusable skill
- `hera_list_skills` - List all skills
- `hera_delete_skill` - Delete user-created skill
- `hera_upgrade_to_agent` - Upgrade skills into full agent

### Team Management
- `hera_create_team` - Create team with coordination mode
- `hera_list_teams` - List all teams
- `hera_delete_team` - Remove a team
- `hera_spawn_team` - Launch team task (creates real sessions)
- `hera_team_message` - Send message between team members

### Memory & Evolution
- `hera_remember` - Store in persistent memory
- `hera_recall` - Search persistent memory
- `hera_evolve_agent` - Append evolution directive
- `hera_list_evolutions` - View evolution history
- `hera_rollback_evolution` - Rollback latest evolution
- `hera_distill_session` - Extract knowledge from session

## Important Implementation Details

### Agent Persistence
- Agents MUST be written to disk as `.md` files to persist across restarts
- The `AgentRegistry.register()` method handles file creation
- Frontmatter format is critical - OpenCode parses it to discover agents
- Evolution directives are appended to the .md file body

### Team Sessions
- Teams use `client.session.create()` to spawn real OpenCode sessions
- Each member is an independent session with full tool access
- Not simulated - actual parallel/sequential execution
- Sessions have parentID linking back to the spawning session

### Skill Embedding
- Skills are embedded into agent prompts as markdown sections
- Format: `## Skill: {name}\n{prompt}`
- Built-in skills are protected from deletion
- User skills can be upgraded to agents via `hera_upgrade_to_agent`

### Evolution System
- Agents can self-improve by appending directives to their prompt
- Evolution log stored in AgentDefinition.evolutionLog
- Active directives injected into agent prompt at runtime
- Rollback marks entries as `rolledBack: true` without deleting

## Configuration

Plugin options in `~/.config/opencode/opencode.json`:

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

## Testing

The project has 88 self-tests covering:
- Plugin loading & hooks
- Tool registration
- Agent creation & persistence
- Skill system & upgrades
- Team coordination
- Memory operations
- Evolution system
- Config hook injection

Run tests by loading the plugin and verifying all tools are registered.

## Common Patterns

### Creating an Agent
```typescript
// Template-based
hera_create_agent({
  name: "my-coder",
  description: "Coding specialist",
  template: "coder",
  mode: "all"
})

// Custom
hera_create_agent({
  name: "sentinel",
  description: "Security auditor",
  prompt: "You are a security expert...",
  mode: "subagent",
  skills: ["caveman", "init"]
})
```

### Creating a Team
```typescript
hera_create_team({
  name: "review-squad",
  description: "Code review team",
  coordination: "parallel",
  members: [
    { agent_name: "sentinel", role: "security" },
    { agent_name: "code-guard", role: "quality" }
  ]
})
```

### Agent Evolution
```typescript
hera_evolve_agent({
  name: "sentinel",
  trigger: "Failed to detect SQL injection",
  observation: "Missed parameterized query check",
  directive: "Always verify database queries use parameterized statements"
})
```

## Debugging

- Agent files: Check `~/.config/opencode/agents/hera/*.md`
- Memory: Check `~/.config/opencode/hera-data/memory/*.json`
- Skills: Check `~/.config/opencode/hera-data/skills/*.json`
- Plugin loading: `opencode list agent` should show all Hera agents
- Tool registration: All 17+ tools should appear in Hera's tool list

## Platform Notes

- Runs on Windows, macOS, Linux
- Uses Bun runtime (not Node.js)
- Path resolution handles Windows vs Unix differences in `resolveConfigRoot()`
- All file operations use `node:fs/promises` for async I/O
