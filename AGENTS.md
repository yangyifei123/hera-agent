# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-21
**Commit:** 7d3b176
**Branch:** master

## OVERVIEW

Hera is an OpenCode plugin on Bun/TypeScript. It creates agents, skills, teams, memory, distillation, evolution, and generated standalone plugins; it is not a standalone server app.

## PRODUCT BOUNDARY

- Hera is an OpenCode plugin, not a standalone agent platform.
- Do not reposition Hera as a Claude Code replacement, OpenCode replacement, or general-purpose agent runtime.
- Installation UX should optimize the OpenCode plugin path: npm install in ~/.config/opencode, OpenCode config registration, doctor diagnostics, and manual/offline fallback.
- Bun is a development/build tool and supported installer, not the only user installation prerequisite.

## STRUCTURE

```
hera-agent/
├── src/index.ts          # plugin entry; initializes config, stores, registries, hooks
├── bin/hera.js           # standalone Node CLI; reads disk state directly
├── src/agents/           # Hera agent definitions + .md agent registry
├── src/tools/            # OpenCode tool domains merged by createAllTools()
├── src/skills/           # built-in skills + user skill package manager
├── src/team/             # team persistence, session spawning, OKR/tree/control modes
├── src/workflow/         # serial/parallel/DAG workflows, validation, progress, templates
├── src/generators/       # generated single-agent/team OpenCode plugins
├── src/memory/           # JSON memory store + auto-memory extraction
├── src/distillation/     # session knowledge extraction
├── src/evolution/        # evolution proposal rules
├── src/analyzer/         # skill package capability/conflict analysis
├── src/types/            # OpenCode client interface tests/types
└── test/                 # shell/portability reports; Bun tests live under src/
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin lifecycle hooks | `src/index.ts` | `config`, `tool`, `experimental.chat.system.transform`, `experimental.session.compacting` |
| Agent creation/deletion | `src/tools/agent-tools.ts`, `src/persistence.ts`, `src/agents/registry.ts` | Keep triple persistence intact |
| Skill package behavior | `src/skills/manager.ts`, `src/skills/*.ts` | Built-ins load first; disk packages override/add users |
| Tool registration | `src/tools/index.ts` plus domain files | Domain split replaces prior monolith |
| Team orchestration | `src/team/manager.ts`, `src/tools/team-tools.ts` | Real OpenCode sessions when client exists; local pending fallback otherwise |
| Workflow orchestration | `src/workflow/manager.ts`, `src/workflow/validator.ts`, `src/tools/workflow-tools.ts` | Serial/parallel/DAG execution; approval and tool result typing must stay aligned |
| Skill/package analysis | `src/skills/analyzer.ts`, `src/analyzer/skill-analyzer.ts` | Capability extraction and conflict/decomposition logic |
| Plugin export | `src/generators/plugin-generator.ts`, `src/generators/team-plugin-generator.ts` | Generated plugins embed prompts + memory tools |
| Agent package migration | `src/tools/package-tools.ts` | Builds/imports `.tar.gz` packages; validate paths and package contents |
| CLI commands | `bin/hera.js` | Node script; does not use plugin runtime |
| Shared values | `src/constants.ts`, `src/helpers.ts`, `src/logger.ts`, `src/validation.ts` | Import here instead of duplicating logic |
| Tests | `src/**/*.test.ts`, `bunfig.toml` | Tests are colocated; root is `src` |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `HeraPlugin` | Plugin | `src/index.ts` | Initializes stores/managers and returns OpenCode hooks |
| `resolveConfigRoot` | function | `src/index.ts` | Runtime config root; Windows uses `USERPROFILE` |
| `AgentRegistry` | class | `src/agents/registry.ts` | Reads/writes OpenCode-discoverable agent `.md` files |
| `persistAgent` / `removeAgent` | functions | `src/persistence.ts` | Triple-write / backup-before-delete contract |
| `SkillManager` | class | `src/skills/manager.ts` | Built-in and disk skill package lifecycle |
| `TeamManager` | class | `src/team/manager.ts` | Team definitions, messages, session spawning |
| `MemoryStore` | class | `src/memory/store.ts` | JSON-per-entry persistence under `hera-data/memory` |
| `createAllTools` | function | `src/tools/index.ts` | Merges tool domain factories |
| `WorkflowManager` | class | `src/workflow/manager.ts` | Executes workflows and manages execution history |
| `WorkflowValidator` | class | `src/workflow/validator.ts` | Validates steps, cycles, dependencies, approval gates |
| `ConcurrencyLimiter` | class | `src/workflow/progress.ts` | Bounds concurrent workflow step execution |
| `SkillAnalyzer` | class | `src/skills/analyzer.ts`, `src/analyzer/skill-analyzer.ts` | Capability, overlap, and package analysis |
| `PluginGenerator` | class | `src/generators/plugin-generator.ts` | Builds standalone agent plugin packages |
| `TeamPluginGenerator` | class | `src/generators/team-plugin-generator.ts` | Builds standalone team plugin packages |

## CONVENTIONS

- Import local TypeScript modules with `.js` extensions; Bun builds ESM from TS.
- Use async `node:fs/promises` for file I/O except first-run sync checks in `onboarding.ts` and standalone CLI sync reads.
- Tests sit beside source: `foo.ts` -> `foo.test.ts`; `bunfig.toml` sets `root = "src"` and coverage.
- User-facing docs may say autonomous/task/universal, but code names stay `primary` / `subagent` / `all`.
- Use `heraLog()` instead of `console.*` in plugin code so `HERA_DEBUG` gates output.
- Constants belong in `src/constants.ts`; helper defaults must return fresh arrays/objects.
- Tool `execute` handlers must match current `@opencode-ai/plugin` `ToolResult` contract: return a string or `{ output, metadata }`. Tests may inspect compatibility metadata, but runtime tools must remain plugin-compatible.

## ANTI-PATTERNS (THIS PROJECT)

- Do not bypass `src/persistence.ts` for agent CRUD; agents must stay synced in memory, `.md`, and MemoryStore.
- Do not replicate config-root logic outside `src/index.ts` and `bin/hera.js`.
- Do not mutate default skills/permissions returned by helpers.
- Do not delete built-in skills; `SkillManager.isBuiltin()` protects them.
- Do not auto-apply evolution proposals; proposal and `hera_evolve_agent` stay separate.
- Do not use network schema URLs for default `hera.json`; internal networks must work offline.
- Do not rely on generated `dist/` as source of truth.
- Do not claim publish readiness unless `dist/index.d.ts` exists after `bun run build`.
- Do not let declaration emit include `src/**/*.test.ts`; `tsconfig.build.json` excludes tests for runtime package output.
- Do not treat README coverage/production claims as truth without running `bun test`, `bun run typecheck`, `bun run lint`, and `npm pack --dry-run`.

## UNIQUE STYLES

- Disk is authoritative for agent definitions at startup; MemoryStore fills only gaps.
- `config` hook re-injects agents immediately so a restart is not required after creation.
- Generated plugins share Hera memory by writing to the same `hera-data/memory` tree.
- Team orchestration is real OpenCode session creation, not simulation; no client means safe pending sessions.

## COMMANDS

```bash
bun install
bun run build
bun test
bun test src/tools/agent-tools.test.ts
hera doctor
```

## NOTES

- Current validation (2026-05-21) passes `bun run format:check`, `bun run typecheck`, `bun run lint` (warnings only), `bun test` (609 pass), `bun run build`, `Test-Path dist/index.d.ts`, and `npm pack --dry-run`.
- Runtime package output uses `tsconfig.build.json`; dry-run package contains 118 files and excludes `*.test.d.ts` declaration artifacts.
- Remaining quality debt: lint still reports warnings for legacy `any`, non-null assertions, and unused symbols; treat warning cleanup separately from release-blocking gates.
- Current worktree may contain generated `dist/` after validation; source edits should stay surgical and separate from build output.
- `rg` may be unavailable in this Windows environment; PowerShell `Get-ChildItem`/`Select-String` or AST tools are reliable fallbacks.
- LSP symbol service may be unavailable; use AST-grep and direct reads for codemap work.
