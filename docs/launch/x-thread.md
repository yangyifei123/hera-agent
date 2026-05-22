# Launch Channel: X (Twitter) Thread

## Thread

**1/7** Introducing Hera — an Agent Factory for OpenCode 🏭

Stop re-typing the same prompts. Create AI agents that remember, evolve, and coordinate.

🧵 Thread on what it does and why 👇

**2/7** The problem: Every OpenCode session starts from zero.
- Same code review instructions
- Same testing workflows
- Same documentation standards

Hera turns these patterns into persistent agents.

**3/7** Install in one command:
```
cd ~/.config/opencode && bun add hera-agent
```

Create your first agent in 2 minutes:
```
opencode run --agent hera "create my-reviewer, mode: all, template: coder"
```

**4/7** Agents that actually remember:
- `hera remember: our project uses strict TypeScript`
- `hera recall: coding style`
→ Persists across sessions. All agents share the same memory pool.

**5/7** Need a review team? One command:
```
opencode run --agent hera "create review-team with code-reviewer and bug-hunter, mode: parallel"
```
→ Real OpenCode sessions running in parallel.

**6/7** What makes Hera different:
✅ Zero network deps (works offline)
✅ Agents export as standalone plugins
✅ Team coordination (serial, parallel, DAG)
✅ Self-evolution via session reflection
✅ MIT licensed

**7/7** Try it: github.com/yangyifei123/hera-agent

2-minute demo: docs/CANONICAL_DEMO.md

Questions? Drop them below 👇