# Hera Positioning Document

> Internal reference. Defines who we build for, what we say, and how we differ.

## ICP (Primary Persona)

**Name**: The OpenCode Power User

- **Role**: Senior backend/full-stack developer or DevOps engineer
- **Tech stack**: TypeScript, Bun, Node.js; already using or evaluating OpenCode CLI
- **Pain point**: Manually re-prompting LLMs for repetitive tasks (code review, testing, documentation); no way to make prompt patterns persistent or composable across sessions
- **Current tool**: Raw OpenCode with manual prompts, or copy-pasting prompt templates from notes files
- **Trigger moment**: They type the same review/debug/document instruction for the 10th time and realize they need reusable, composable agent logic

**Why this persona**: OpenCode users are a defined, growing niche. They already know the CLI, the plugin model, and the multi-model workflow. Hera plugs directly into their existing toolchain — zero ecosystem switch.

## Secondary Persona

**Name**: The AI Agent Experimenter

- **Role**: Engineer or researcher exploring multi-agent orchestration patterns
- **Tech stack**: Mixed; evaluating frameworks (LangChain, CrewAI, AutoGen) but not yet locked in
- **Pain point**: Python agent frameworks require significant boilerplate; they want to prototype agent teams fast without leaving their terminal
- **Current tool**: LangChain / CrewAI / AutoGen with Python, or ad-hoc shell scripts
- **Trigger moment**: They see Hera's `opencode run --agent hera "create review-team"` and realize they can spin up a coordinated agent team in one command

**Why secondary**: This persona may convert if they're willing to try OpenCode as their runtime. They expand the funnel but aren't the core adopter yet.

## One-Liner

> **Create persisting AI agents with memory and teams — inside OpenCode.**

Passes "so what?":
- "Create agents" → so what? → "persisting" — they survive across sessions
- "persisting agents" → so what? → "with memory" — they learn from past work
- "with memory" → so what? → "and teams" — they coordinate, not just chat
- "and teams" → so what? → "inside OpenCode" — no new runtime, no Python, no API server

## H1 Headline

> **Hera — Agent Factory for OpenCode**

Alternative considered and rejected:
- ~~"Hera — Create agents that remember and collaborate"~~ — too vague, no ecosystem anchor
- ~~"Hera — Self-evolving AI agents with persistent memory"~~ — "self-evolving" sounds like a marketing claim, not a provable feature
- ~~"Hera — The multi-agent plugin for OpenCode"~~ — "multi-agent" is narrowing; Hera also creates single agents

## Alternatives Matrix

| Dimension | Hera | Raw OpenCode Prompts | CrewAI | AutoGen |
|-----------|------|----------------------|--------|---------|
| **Runtime** | OpenCode plugin (Bun/TS) | OpenCode native | Python process | Python process |
| **Setup** | `npm install hera-agent` (Bun optional) | N/A (manual each session) | `pip install` + Python env | `pip install` + Python env |
| **Persistence** | Memory across sessions | None (session-scoped) | Per-agent memory via code | Per-agent memory via code |
| **Self-improvement** | Evolution directives append automatically | No | No built-in mechanism | No built-in mechanism |
| **Team orchestration** | Built-in (parallel/sequential/DAG) | Manual prompt chaining | Built-in (process-driven) | Built-in (conversation-driven) |
| **Export as plugin** | Yes (agent → standalone plugin) | N/A | No | No |
| **Offline/internal net** | Yes (zero network deps) | Yes | Varies by LLM provider | Varies by LLM provider |
| **Learning curve** | Low (if you know OpenCode) | None (but no persistence) | Medium (Python class scaffolding) | Medium-High (conversation patterns) |
| **Ecosystem lock-in** | OpenCode ecosystem | OpenCode ecosystem | Python/LangChain ecosystem | Python ecosystem |
| **When to choose** | You're in OpenCode and want agents that persist, evolve, and coordinate | You only need single-session prompts | You need Python-native multi-agent with external integrations | You need conversation-driven multi-agent research |

### Key Differentiators (honest)

1. **Only agent factory in the OpenCode ecosystem** — not a port, native plugin
2. **Zero-config persistence** — memory and evolution work out of the box, no code to write
3. **One-command team creation** — `hera create team` vs. writing Python class scaffolding
4. **Plugin export** — agents become distributable OpenCode plugins, not just runtime objects
5. **Honest trade-off**: Hera is OpenCode-only. If you're not in that ecosystem, Hera isn't for you yet.

### Honest Weaknesses (not hidden)

1. **Ecosystem dependency** — requires OpenCode; no standalone mode
2. **Young ecosystem** — OpenCode has fewer users than LangChain/Python agent frameworks
3. **Limited external integrations** — agents primarily interact through OpenCode tools, not arbitrary APIs
4. **Documentation gaps** — no canonical demo, some UX confusion around agent modes

## Product Boundary (Non-Negotiable)

Hera must stay an OpenCode plugin. Do not reposition it as a standalone agent platform, Claude Code replacement, or OpenCode competitor.

Allowed scope:
- Extend OpenCode with agent creation, memory, teams, packaging, and workflows.
- Improve installation and diagnostics for the OpenCode plugin path.
- Export generated agents/teams as OpenCode plugins.

Out of scope for now:
- Standalone server/runtime.
- Browser or desktop app platform.
- Claude Code replacement.
- General Python-style agent framework.
- Competing OpenCode CLI/runtime.
