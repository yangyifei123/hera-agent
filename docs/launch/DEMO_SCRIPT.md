# Hera Beta Demo Script

> A 2-3 minute screen recording script for public beta. Keep the language concrete and avoid platform claims Hera does not support.

## Opening: 10 seconds

"This is Hera, an agent factory plugin for OpenCode. It turns prompt patterns you repeat every day into persistent agents with memory and teams. It is not a separate server or a replacement for OpenCode — it runs inside OpenCode."

Show:

```bash
opencode --version
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

## Install: 25 seconds

Show the npm path:

```bash
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Narration:

"The recommended install path uses npm with an explicit OpenCode config prefix. Bun is supported for development, but users do not need Bun to install the published package."

## Create an Agent: 35 seconds

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js create agent my-reviewer --template coder --mode all
opencode --agent my-reviewer "review src/index.ts for error handling gaps"
```

Narration:

"The agent is written to OpenCode's agent registry, so it survives restarts. Use `mode: all` when you want to call the agent directly."

## Add Memory: 25 seconds

```bash
opencode run --agent hera "remember: this project uses strict TypeScript and prefers small atomic commits"
opencode run --agent hera "recall: TypeScript and commit style"
```

Narration:

"Hera stores persistent memory locally under the OpenCode config directory. Agents can recall project conventions in later sessions."

## Create a Team: 40 seconds

```bash
opencode run --agent hera "create review-team with my-reviewer and bug-hunter, mode: parallel"
opencode run --agent hera "list teams"
opencode run --agent hera "send message to review-team: ask bug-hunter to look for edge cases"
opencode run --agent hera "remember in review-team: auth module needs security-first review"
```

Narration:

"Teams have two coordination layers: an inbox for messages and acknowledgements, and a shared workspace or blackboard for durable team context."

"Teams can also carry an editable workflow recipe, so you can preview and change the order of work without learning the internal engine."

## Skill Upgrade Preview: 25 seconds

```bash
opencode run --agent hera "upgrade skills memory, communicate to team coordination-lab, coordination: parallel, management: control, dry_run: true"
```

Narration:

"Before turning skills into agents or teams, dry-run preview shows what Hera would create, including inherited skills and naming conflicts."

## Close: 15 seconds

"If you already use OpenCode and keep retyping the same prompts, Hera gives you persistent agents, memory, and teams without leaving your existing workflow. Try the canonical demo in `docs/CANONICAL_DEMO.md`."
