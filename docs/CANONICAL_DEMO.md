# Hera 2-Minute Canonical Demo

> This is the single authoritative demo path for Hera. Every external link, blog post, or video should point here.

## Prerequisites

- [OpenCode](https://github.com/opencode-ai/opencode) CLI installed
- npm/Node.js installed (recommended). Bun also works, but is not required.

## Step 1: Install (30 seconds)

Recommended npm path:

```bash
# Linux/macOS
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode"
npm install --prefix "$env:USERPROFILE\.config\opencode" hera-agent
```

Bun path, if you prefer Bun:

```bash
cd ~/.config/opencode && bun add hera-agent
```

Manual offline path:

```bash
# Online machine
npm pack hera-agent

# Target machine
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode /path/to/hera-agent-<version>.tgz
```

**Expected output**: Package installed, no errors.

## Step 2: Verify (15 seconds)

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

If installed with Bun, this also works:

```bash
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

**Expected output**:

```text
Running Hera health check...
OpenCode config directory found
Hera package installed
Build artifacts present
Agent registry accessible
Memory store accessible
All checks passed
```

## Step 3: Create an Agent (20 seconds)

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js create agent my-reviewer --template coder --mode all
```

**What happens**:

- Hera creates `my-reviewer` agent as a `.md` file in `~/.config/opencode/agents/`.
- Agent inherits 11 built-in skills: caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact, workflow-orchestration, brainstorming, skill-creator.
- Agent is immediately available via `--agent my-reviewer`.

**Expected output**: Confirmation that agent was created, the `.md` path was written, and the next `opencode --agent my-reviewer` command is shown.

## Step 4: Use the Agent (15 seconds)

```bash
opencode --agent my-reviewer "review the code in src/index.ts for error handling gaps"
```

**What happens**:

- OpenCode loads `my-reviewer` agent.
- Agent uses its skills automatically.
- Response includes code review feedback.

## Step 5: Memory Persists (15 seconds)

```bash
# Store knowledge
opencode run --agent hera "remember: our project uses 2-space indentation, strict TypeScript, and REST APIs with snake_case"

# Recall it in a new session
opencode run --agent hera "recall: coding style"
```

**What happens**:

- `remember` stores key-value data in the shared memory pool.
- `recall` searches across stored memories.
- Memory persists across OpenCode sessions and restarts.

## Step 6: Create a Team (15 seconds)

```bash
opencode run --agent hera "create review-team with my-reviewer and a bug-hunter, mode: parallel"
```

**What happens**:

- Hera creates a team with parallel coordination.
- Team members share a blackboard-style workspace via `hera_team_remember` / `hera_team_recall` and an inbox via `hera_team_message` / `hera_get_team_messages` / `hera_ack_team_messages`.
- Team spawns real OpenCode sessions for each member when a client exists.
- Results are coordinated and returned.
- Teams can also carry an editable workflow recipe, which is stored with the team and shown in team status.

Optional skill upgrade preview:

```bash
opencode run --agent hera "upgrade skills memory, communicate to team coordination-lab, coordination: parallel, management: control, dry_run: true"
```

This preview shows the member agents Hera would create before anything is persisted.

Optional team recipe preview:

```bash
opencode run --agent hera "preview team workflow: recipe"
```

## Step 7: Verify Team Works (10 seconds)

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js status
```

**Expected output**: Hera status with agent, skill, team, and plugin configuration counts.

---

## Time Budget

| Step | Time | Running Total |
|------|------|---------------|
| Install | 30s | 30s |
| Verify | 15s | 45s |
| Create Agent | 20s | 1m 05s |
| Use Agent | 15s | 1m 20s |
| Memory | 15s | 1m 35s |
| Create Team | 15s | 1m 50s |
| Verify Team | 10s | 2m 00s |

**Total: 2 minutes** (excluding Node/OpenCode initial install)

## Cleanup

```bash
opencode run --agent hera "delete my-reviewer"
opencode run --agent hera "delete review-team"

cd ~/.config/opencode
npm uninstall hera-agent
```

## Troubleshooting the Demo

| Problem | Fix |
|---------|-----|
| `bun add` fails | Use npm: `npm install --prefix ~/.config/opencode hera-agent` |
| `npm install` fails | Verify Node.js LTS and npm are installed |
| `hera` not in agent list | Restart OpenCode or run `opencode agent reload` |
| Agent creation fails | Run `node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor` |
| Agent not responding with `--agent` | Create with `mode: all`, not `mode: subagent` |
| Memory not persisting | Check `~/.config/opencode/hera-data/memory/` exists |
