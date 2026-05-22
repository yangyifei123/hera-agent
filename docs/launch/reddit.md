# Launch Channel: Reddit Post

## Subreddit: r/LocalLLaMA

## Title

Hera — OpenCode plugin that creates AI agents with persistent memory and team coordination (no Python, no API server)

## Body

Hey r/LocalLLaMA,

I've been building Hera, an agent factory plugin for OpenCode. It creates AI agents that share persistent memory, evolve from experience, and coordinate as teams — all inside your existing OpenCode workflow.

**Why this matters for local-first users:**
- Zero network dependencies (works fully offline from v2.0)
- Runs inside OpenCode, no separate server needed
- Memory is JSON-based, stored locally at `~/.config/opencode/hera-data/`
- Agents can be packaged and shared as `.tar.gz` files

**Quick demo:**

```bash
# Install
cd ~/.config/opencode && bun add hera-agent

# Create agent
opencode run --agent hera "create my-reviewer, mode: all, template: coder"

# Use it
opencode --agent my-reviewer "review src/auth.ts for security issues"

# Memory persists across sessions
opencode run --agent hera "remember: use 2-space indentation"
opencode run --agent hera "recall: coding style"
```

**How it differs from LangChain/CrewAI/AutoGen:**
- Those are Python frameworks. Hera is a TypeScript/Bun OpenCode plugin.
- Different ecosystem, different trade-offs. Hera is for developers already using OpenCode.
- No orchestrator server to run — agents use real OpenCode sessions.

**Architecture:**
- 8 built-in skills inherited by every agent (caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact)
- 43 management tools (create, delete, export, package, team coordination, workflow, etc.)
- Team modes: parallel, sequential, DAG
- Agents export as standalone plugins

Repo: https://github.com/yangyifei123/hera-agent

Open to feedback on the memory model, team coordination design, or anything else.