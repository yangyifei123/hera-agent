# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hera is an **OpenCode plugin** (not a standalone app) that acts as an agent factory: it creates child agents, manages skills, coordinates teams, persists memory across sessions, and supports self-evolution via prompt directives. It runs inside the OpenCode CLI on the Bun runtime.

**Critical concept**: Child agents are persisted as `.md` files in `~/.config/opencode/agents/hera/` with YAML frontmatter. OpenCode auto-discovers them by scanning this directory at startup — the plugin doesn't "register" them through an API. The plugin's `config` hook *also* injects the same agents into OpenCode's in-memory agent map for immediate availability without a restart. Both paths must stay consistent.

## Build, Test, Run

```bash
bun install              # install deps
bun run build            # bundle src/index.ts → dist/ (ESM, Bun target, plugin/SDK externalized)
bun run dev              # watch mode

bun test                 # run full test suite (config in bunfig.toml — root=src, coverage on)
bun test src/path/to/file.test.ts        # single test file
bun test --test-name-pattern "name"      # single test by name

# Verify installation
hera doctor              # checks config, agents, skills, disk state

# Note: `package.json` "scripts.test" is an echo placeholder — DO NOT rely on `bun run test`.
# Always invoke `bun test` directly so bunfig.toml is honored.
```

### Windows-specific commands

```powershell
# Install and build
bun install; if ($?) { bun run build }

# Verify
hera doctor

# Run tests
bun test
```

The CLI binary (`bin/hera.js` → `src/cli.ts`) is invoked as `hera <command>` after install; it reads disk state directly (does **not** go through the plugin runtime).

## Architecture

### Plugin entry & lifecycle (`src/index.ts`)

The default export is an async `Plugin` function that returns four hooks:

| Hook | Purpose |
|------|---------|
| `config` | Injects Hera + every registered child agent into `input.agent` (the in-memory map OpenCode uses). Builds the full prompt by concatenating `def.prompt` + embedded skill sections + active evolution directives. |
| `tool` | Returns the merged tool map from `createAllTools(ctx)`. |
| `experimental.chat.system.transform` | Appends Active Teams / Registered Agents / Available Skills sections to Hera's system prompt. |
| `experimental.session.compacting` | Triggers distillation prompts and (if `auto_memory: true`) runs `extractMemories()` over compacted messages. |

On startup the entry function: resolves the config root (`resolveConfigRoot` — Windows uses `USERPROFILE/.config/opencode`, otherwise `$HOME/.config/opencode`), auto-creates `hera.json` if absent, runs onboarding on first load, then **loads agents from disk first** and only fills gaps from the MemoryStore. Disk is authoritative.

### Module layout (post-refactor)

The codebase was split out of a monolith. Key seams:

- **`src/agents/`** — `registry.ts` writes/reads `.md` files; `hera.ts` defines the Hera agent and the 10 templates plus `buildAgentPrompt()` (the canonical prompt assembler used by both registry and `config` hook).
- **`src/skills/`** — 5 built-in skill modules + `manager.ts`. Built-in skills are protected from deletion.
- **`src/team/`** — `manager.ts` creates real OpenCode sessions via `client.session.create()`. Teams are NOT simulated. `templates.ts` provides preset team shapes.
- **`src/memory/`** — `store.ts` JSON-per-entry persistence; `smart-extractor.ts` powers auto-memory during session compaction.
- **`src/distillation/`** — `engine.ts` extracts decisions/patterns/skills from sessions.
- **`src/evolution/`** — `auto-evolve.ts` analyzes sessions and proposes evolution directives.
- **`src/tools/`** — Tool registration is split by **domain**: `agent-tools`, `skill-tools`, `team-tools`, `memory-tools`, `evolution-tools`, `system-tools`. `index.ts` exports `createAllTools(ctx)` which merges them. Each domain takes only the context slice it needs (`AgentToolCtx`, `SkillToolCtx`, etc. — see `types.ts`).
- **`src/persistence.ts`** — Unified `persistAgent` / `removeAgent` / `backupAgent` / `restoreAgent`. Backups are JSON in `hera-data/backups/`, capped at 5 per agent (oldest auto-pruned).
- **`src/constants.ts`** — All magic numbers (timeouts, limits, default skills/permissions) live here. Import constants rather than hard-coding values.
- **`src/helpers.ts`** — `getDefaultSkills()`, `getDefaultPermission()`, `buildSkillPromptEmbedding()`. **Always returns fresh copies** to avoid shared-reference mutation bugs — preserve this when editing.
- **`src/logger.ts`** — `heraLog(level, msg, ...)`. Use this instead of `console.*` so output respects `HERA_DEBUG`.
- **`src/validation.ts`** — Agent name validation; call before any file operation that uses the name as a path segment.
- **`src/onboarding.ts`** — First-run setup gated by `.onboarded` flag in `hera-data/`.
- **`src/cli.ts`** — Standalone CLI; reads disk state directly, bypasses the plugin runtime.

### Triple persistence for agents

When `persistAgent()` runs, an agent lands in three places simultaneously:
1. **In-memory** `registeredAgents: Map<string, AgentDefinition>` — used by the `config` hook.
2. **Disk `.md`** in `agents/hera/` — what OpenCode auto-discovers on startup.
3. **MemoryStore JSON** — fallback so an agent survives even if its `.md` is lost.

On startup the entry function loads disk first, then fills gaps from MemoryStore. When modifying agent persistence, keep all three in sync — diverging them produces ghost agents.

### Prompt assembly

The full prompt for any child agent is assembled the same way in two places: `AgentRegistry.register()` (when writing the `.md`) and the `config` hook (when injecting at runtime). Both must produce the same string. The shape is:

```
{def.prompt}

## Skill: {skill1.name}
{skill1.prompt}

## Skill: {skill2.name}
{skill2.prompt}
...

## Evolved Directives
1. [ISO timestamp] {directive}
2. ...
```

Only non-`rolledBack` evolution entries are included. Rollback is a soft flag, never a delete.

### Path resolution

`resolveConfigRoot()` in `src/index.ts` and `getConfigRoot()` in `src/cli.ts` are the only places that compute the config root. The CLI also honors `HERA_DIR` as an override. On Windows, paths under `USERPROFILE` are used; everywhere else, `$HOME`. Don't replicate this logic elsewhere — import or refactor.

## Cross-Platform Notes

### Config Root Directory
- **Windows**: `%USERPROFILE%\.config\opencode` (e.g., `C:\Users\{username}\.config\opencode`)
- **Linux/macOS**: `~/.config/opencode`

### Path Separator
- Windows uses backslash (`\`)
- Linux/macOS uses forward slash (`/`)
- Node.js `path.join()` handles this automatically

### PowerShell vs Bash
- **PowerShell**: Use `$env:USERPROFILE` for home directory
- **Bash**: Use `$HOME` or `~` for home directory
- **Windows workaround**: Use `cmd /c` to bypass PowerShell path restrictions

### Environment Variables
- **Windows**: `USERPROFILE` (not `HOME`)
- **Linux/macOS**: `HOME`

## Configuration

Plugin config lives in `~/.config/opencode/hera.json` (auto-created on first load). Relevant flags:

- `auto_evolve: true` — enables session-compacting reflection prompts and `hera_propose_evolution`.
- `auto_memory: true` — runs `extractMemories()` during compaction and saves to MemoryStore with `source: "auto-memory"` metadata.
- `disabled_agents` / `disabled_skills` / `disabled_tools` — runtime disable without deleting files.
- `default_model` — overrides the per-agent model.

Env vars: `HERA_DEBUG` (debug logging), `HERA_DIR` (CLI config root override).

## Conventions when editing this codebase

- **Don't bypass `persistence.ts`** for agent CRUD. The triple-write contract lives there.
- **Don't hard-code constants** — add to `src/constants.ts` and import.
- **Don't mutate shared default arrays/objects** — `helpers.ts` returns fresh copies on purpose. Preserve that invariant.
- **Tool context slices over the full `PluginContext`** — when adding a tool to an existing domain, take only the matching `*ToolCtx` slice from `types.ts`.
- **Agent modes**: code uses `primary` / `subagent` / `all` (the OpenCode SDK names). Docs refer to them as `autonomous` / `task` / `universal`. Keep the code names; rename only in user-facing text.
- **Tests live next to source** (`foo.ts` ↔ `foo.test.ts`). `bunfig.toml` sets `root = "src"` and enables coverage. Tests must pass `bun test` before any commit.
- **File I/O is async** via `node:fs/promises`. The lone exception is `isFirstRun()` in `onboarding.ts`, which uses sync `accessSync` because it runs in the init phase.

## Where things land on disk

```
~/.config/opencode/
├── hera.json                       # plugin config
├── agents/hera/<name>.md           # child agents (OpenCode auto-discovers)
└── hera-data/
    ├── .onboarded                  # first-run flag
    ├── memory/<id>.json            # MemoryStore entries
    ├── skills/<name>.json          # user-created skills
    └── backups/<name>-<ts>.json    # agent backups (max 5 per agent)
```

## Reference docs in this repo

- `README.md` — user-facing install/usage.
- `ARCHITECTURE.md` — module-by-module breakdown with mermaid diagram and data flow walkthroughs. Read this when planning refactors.
