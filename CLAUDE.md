# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hera is an **OpenCode plugin** (not a standalone app) that acts as an agent factory: it creates child agents, manages reusable skills, coordinates teams, persists memory across sessions, and can export agents/teams as standalone plugins.

The most important mental model: child agents are persisted as Markdown files in `~/.config/opencode/agents/hera/`. OpenCode discovers those files on startup, while Hera's `config` hook also injects the same agents into OpenCode's in-memory agent map so they are usable immediately in the current session.

## Common Commands

```bash
bun install
bun run dev                       # watch src/index.ts
bun run build                     # rebuild dist/ and .d.ts output

bun run lint
bun run lint:fix
bun run typecheck
bun run format:check
bun run format

bun test                          # full test suite (bunfig.toml sets root=src, coverage, 30s timeout)
bun test src/path/to/file.test.ts # single test file
bun test --test-name-pattern "name"  # single test by name

# Local CLI checks from the repo root
node bin/hera.js doctor
node bin/hera.js help
```

Release/publish gate (`prepublishOnly` in `package.json`):

```bash
bun run typecheck && bun run lint && bun run build && bun test && npm pack --dry-run
```

Installed users invoke the CLI as `hera <command>`, but inside this repo the reliable form is `node bin/hera.js <command>`.

## Big-Picture Architecture

### 1. Two execution surfaces must stay in sync

- **Plugin runtime**: `src/index.ts`
  - Initializes stores/managers
  - Registers OpenCode hooks (`config`, `tool`, `experimental.chat.system.transform`, `experimental.session.compacting`)
  - Injects Hera and child agents into the live OpenCode session
- **Standalone CLI**: `bin/hera.js`
  - Handles `install`, `doctor`, `quickstart`, `create`, `init`, `status`, `list*`, `update`, `upgrade`, `uninstall`, etc.
  - Reads and writes disk state directly; it does **not** go through the plugin runtime

If you change templates, default skills, config-root resolution, agent naming rules, or onboarding assumptions, check both `src/` and `bin/hera.js`.

### 2. Startup flow in `src/index.ts`

On plugin startup, Hera:

1. Resolves the OpenCode config root via `getConfigRoot()` in `src/constants.ts`
2. Creates `hera.json` with defaults if it does not exist yet
3. Initializes:
   - `MemoryStore`
   - `SkillManager`
   - `TeamManager`
   - `WorkflowManager`
   - `DistillationEngine`
   - `AgentRegistry`
4. Creates the background engine via `createEngine()` from `src/engine/` (`init()` -> `recover()` -> `start()`), which exposes `taskStore`, `loopManager`, and `supervisor` to the plugin context
5. Rewrites `hera.md` so Hera itself is always natively discoverable by OpenCode
6. Runs first-run onboarding via `src/onboarding.ts`
7. Loads agents from disk first, then fills missing ones from memory-store backups
8. Builds the merged tool map via `src/tools/index.ts`

Disk is authoritative for agents; the memory store is a fallback, not the primary source.

### 3. Agent persistence is intentionally multi-layered

`src/persistence.ts` is the canonical place for agent lifecycle operations.

`persistAgent()` writes an agent to three places:

1. `registeredAgents` in memory
2. `~/.config/opencode/agents/hera/<name>.md` via `AgentRegistry`
3. `MemoryStore` JSON as a fallback copy

`removeAgent()`, `backupAgent()`, `listBackups()`, and `restoreAgent()` also live there. Do not scatter agent CRUD logic across random tool files.

### 4. Prompt assembly is a sharp edge

Prompt construction currently spans multiple paths:

- `buildAgentPrompt()` in `src/agents/hera.ts` renders the persisted Markdown body
- the plugin `config` hook in `src/index.ts` builds the runtime prompt used for live agent injection

This is easy to drift: disk-backed agents are parsed back from rendered `.md` bodies, so changing only one path can cause duplicated or mismatched embedded skill sections. If you touch prompt composition, verify the full flow: create agent -> reload/restart -> invoke agent.

### 5. Skills are both built-in prompts and on-disk packages

`src/skills/manager.ts` loads three sources of skills:

- **11 built-in skills** from `src/skills/*.ts`
- legacy `SkillDefinition` entries stored in `MemoryStore`
- directory-based `SkillPackage` bundles under `hera-data/skills/<name>/` (`SKILL.json`, `SKILL.md`, optional extra files/config)

Built-in skills are non-deletable. The canonical default inherited skill list lives in `DEFAULT_SKILLS` in `src/constants.ts`; keep the CLI defaults in `bin/hera.js` synchronized with it.

### 6. Teams, workflows, and recipes are separate concepts

Do not conflate these layers:

- **Teams** (`src/team/manager.ts`): spawn real OpenCode sessions via `client.session.create()`; coordination modes are `parallel`, `sequential`, `adaptive`
- **Team management modes** (`simple`, `okr`, `tree`, `control`): how a team tracks work and approvals
- **Generic workflows** (`src/workflow/`): serial/parallel/DAG workflow definitions and executions stored in memory
- **Team workflow recipes** (`src/team/workflow-recipe.ts`, `TeamDefinition.workflow`): lightweight editable step lists attached to teams

Teams also have two collaboration channels:

- inbox-style messages (`hera_team_message`, `hera_get_team_messages`, `hera_ack_team_messages`)
- shared blackboard memory (`hera_team_remember`, `hera_team_recall`)

### 7. Tooling is split into 11 domains

`createAllTools()` merges these tool groups:

- `agent-tools`
- `skill-tools`
- `team-tools`
- `memory-tools`
- `evolution-tools`
- `system-tools`
- `package-tools`
- `workflow-tools`
- `task-tools`
- `loop-tools`
- `recovery-tools`

Tools listed in `hera.json` `disabled_tools` are filtered out of the merged map.

`src/types.ts` defines per-domain context-slice interfaces, but the current tool factories still accept the full `PluginContext` and destructure what they need. Treat the slice interfaces as the architectural seam, not as something already fully enforced.

### 8. Background engine: tasks, loops, recovery

`src/engine/` is a self-contained subsystem behind `createEngine()` (`src/engine/index.ts`):

- **Task supervisor** (`supervisor.ts`, `task-store.ts`, `executor.ts`): persisted background tasks executed in OpenCode sessions, with acceptance criteria validation (`acceptance.ts`)
- **Loop manager** (`loop-manager.ts`, `loop-store.ts`): recurring/looping work
- **Active work context** (`active-work.ts`): tracks in-flight work for crash recovery; `engine.recover()` runs on startup before `engine.start()`

The engine's `taskStore`, `loopManager`, and `supervisor` land on `PluginContext` and back `task-tools`, `loop-tools`, and `recovery-tools`.

### 9. Memory, distillation, and auto-learning hooks

- `MemoryStore` persists one JSON file per entry under typed subdirectories in `hera-data/memory/`
- `experimental.session.compacting` in `src/index.ts` is where Hera plugs in:
  - distillation guidance
  - optional auto-memory extraction via `extractMemories()`
  - optional auto-evolution prompting
- `auto_memory: true` causes extracted memories to be saved with `metadata.source = "auto-memory"`

### 10. Export and packaging are separate surfaces too

- `src/generators/plugin-generator.ts` and `src/generators/team-plugin-generator.ts` export agents/teams as standalone OpenCode plugins
- `src/tools/package-tools.ts` packages and unpacks agents as `.tar.gz` archives, optionally with related memory

One subtle path detail: generated plugin memory helpers look at `HERA_DIR`, while the main plugin runtime and standalone CLI resolve the OpenCode config root via `HERA_CONFIG_ROOT`. Keep those env-var contracts straight when editing path logic.

## Path and Config Resolution

- Canonical OpenCode config-root logic lives in `resolveOpenCodeConfigRoot()` / `getConfigRoot()` in `src/constants.ts`
- `bin/hera.js` duplicates that logic and must stay aligned
- Windows uses `USERPROFILE/.config/opencode`; other platforms use `HOME/.config/opencode`
- `hera.json` defaults are created in `src/index.ts`; if you add config fields, update both the runtime default object and `HeraConfig` in `src/types.ts`

## Repo-Specific Conventions

- Use `heraLog()` instead of `console.*`
- Use `validation.ts` before turning agent names into path segments
- Prefer constants from `src/constants.ts` over hardcoded limits/timeouts/defaults
- Preserve the fresh-copy behavior in `helpers.ts` (`getDefaultSkills()`, `getDefaultPermission()`)
- Use `atomicWriteText()` / `atomicWriteJson()` for persisted files that must survive interrupted writes
- Tests live next to source files under `src/`
- Onboarding (`src/onboarding.ts`) seeds a default `quick-fixer` agent plus a `dev-team` with `architect`, `senior-dev`, and `qa-engineer`

## Important Runtime Artifacts

```text
~/.config/opencode/
├── hera.json
├── agents/
│   ├── hera/*.md              # disk-backed agents for OpenCode discovery
│   └── hera-generated/        # generated plugin exports
└── hera-data/
    ├── .onboarded
    ├── memory/                # MemoryStore JSON entries
    ├── skills/<name>/         # SkillPackage directories
    └── packages/              # tar.gz agent packages
```

## Reference Docs

- `README.md` — install paths, CLI usage, templates, teams, packaging
- `ARCHITECTURE.md` — deeper module-by-module walkthrough
- `docs/MODES.md` — agent mode terminology and usage
- `docs/CANONICAL_DEMO.md` and `docs/SHOWCASE.md` — representative user flows
