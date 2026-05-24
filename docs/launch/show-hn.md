# Launch Channel: Show HN

## Title

Show HN: Hera — Agent Factory for OpenCode (create agents that remember and coordinate)

## Body

I built Hera because I kept re-typing the same prompt patterns in OpenCode sessions — code review instructions, testing workflows, documentation standards. Each session started from zero.

Hera turns those recurring patterns into persistent agents. Each agent:

- **Remembers** across sessions (shared memory pool)
- **Evolves** by reflecting on past work (appends improvement directives)
- **Coordinates** as teams (parallel, sequential, or DAG workflows)
- **Coordinates** as teams with editable workflow recipes and existing execution modes
- **Exports** as standalone OpenCode plugins

Recommended npm install path:

```
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Two minutes to your first agent:

```
opencode run --agent hera "create my-reviewer, mode: all, template: coder"
opencode --agent my-reviewer "review src/auth.ts for security issues"
```

The memory system means your agents learn your project conventions over time. The team system means a 3-agent review team (style, security, logic) can run in parallel.

Hera is an OpenCode plugin — no Python, no API server, no new runtime. If you're already in the OpenCode ecosystem, it plugs right in.

Repo: https://github.com/yangyifei123/hera-agent
Demo: https://github.com/yangyifei123/hera-agent/blob/master/docs/CANONICAL_DEMO.md

Happy to answer questions about the architecture, memory model, or team coordination system.

## Key Points for Comments

- Why not CrewAI/AutoGen? Those are Python frameworks. Hera is native to OpenCode. Different ecosystem, different trade-offs.
- Memory is JSON-based, persistent across sessions, shared between all agents.
- Teams use real OpenCode sessions, not simulated orchestration.
- 11 built-in skills are inherited by every agent: caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact, workflow-orchestration, brainstorming, and skill-creator.
- 43 management tools for lifecycle, packaging, migration.
- MIT licensed, zero network dependencies (works offline/in internal networks from v2.0).

## Tags

`ai`, `agents`, `developer-tools`, `open-source`
