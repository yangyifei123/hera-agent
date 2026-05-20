# SRC KNOWLEDGE BASE

## OVERVIEW

`src/` is the plugin runtime. It wires OpenCode hooks, domain managers, persistence, built-in skills, and generated plugin support.

## STRUCTURE

```
src/
├── index.ts          # main Plugin factory and hook registration
├── agents/           # Hera prompt/templates + .md registry
├── tools/            # public tool factories split by domain
├── skills/           # built-in skills and disk skill package CRUD
├── team/             # teams, messages, session spawning, management modes
├── generators/       # standalone plugin package generation
├── memory/           # JSON store and smart extraction
├── distillation/     # session-to-knowledge extraction
├── evolution/        # failure-pattern -> directive proposal
├── analyzer/         # SkillPackage capability/conflict analysis
└── types/            # OpenCode client shape
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Startup sequence | `index.ts` | Config root -> managers -> registry -> onboarding -> hooks |
| Plugin context shape | `types.ts` | Keep fields compatible with all tool domains |
| Config defaults | `index.ts`, `constants.ts` | Default `hera.json` is created on first load |
| Agent prompt parity | `agents/hera.ts`, `agents/registry.ts`, `index.ts` | Registry and config hook must assemble prompts consistently |
| Safe deletion/restore | `persistence.ts` | Backup cap is 5 per agent |
| Tests for cross-cutting helpers | `*.test.ts` in root of `src/` | Constants, helpers, logger, onboarding, persistence, validation |

## CONVENTIONS

- Keep runtime modules ESM-compatible: imports target `.js`, not `.ts`.
- Prefer narrow context slices in tool modules even when the full `PluginContext` is available.
- Config/runtime paths are carried in `HeraPaths`; avoid ad-hoc path recomputation.
- When adding a manager, initialize it in `index.ts` before creating `PluginContext`.

## ANTI-PATTERNS

- Do not add synchronous plugin-runtime file I/O outside documented first-run exceptions.
- Do not add a new tool domain without merging it in `tools/index.ts`.
- Do not write directly to `~/.config/opencode` from random modules; pass through paths/context.
- Do not assume `client` exists; team/session paths must handle undefined client.

## TESTS

```bash
bun test src/index.test.ts
bun test src/persistence.test.ts
bun test src/helpers.test.ts
bun test
```
