# Hera Terminal Demo

Use this script for an asciinema, GIF, or short launch video. The README image at `docs/assets/hera-terminal-demo.svg` is a lightweight placeholder; replace it with the rendered recording when available.

## 30-second path

```bash
# Install into OpenCode config
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent

# Verify
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor

# Create a persistent agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js create agent my-reviewer --template coder --mode all

# Use it
opencode --agent my-reviewer "review src/index.ts for error handling gaps"
```

## 2-minute path

```bash
# Memory
opencode run --agent hera "remember: our project uses strict TypeScript and 2-space indentation"
opencode run --agent hera "recall: coding style"

# Team
opencode run --agent hera "create review-team with my-reviewer and bug-hunter, mode: parallel"
opencode run --agent hera "spawn review-team to review src/index.ts"

# Status
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js status
```

## Recording checklist

1. Start from a clean terminal with OpenCode already installed.
2. Keep each command visible long enough to read.
3. Show the generated agent file path and then immediately use the agent.
4. End on `hera status` so viewers see agents, skills, teams, and config state.
