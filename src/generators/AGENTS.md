# GENERATORS KNOWLEDGE BASE

## OVERVIEW

`src/generators/` creates standalone OpenCode plugin packages for single agents and whole teams.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Single-agent plugin generation | `plugin-generator.ts` | Package JSON, tsconfig, plugin index, install docs, auto-build/install |
| Team plugin generation | `team-plugin-generator.ts` | Wraps member agents with team context and shared memory tools |
| Build/install tests | `plugin-generator.test.ts`, `team-plugin-generator.test.ts`, `e2e-build.test.ts` | Use fake command runners where possible |

## CONVENTIONS

- Generated plugins use Bun, ESM, `@opencode-ai/plugin`, and externalize plugin SDK in build script.
- Prompts must be assembled with `buildAgentPrompt()` so `.md` and plugin outputs have skill/evolution parity.
- Generated memory tools write to the same `hera-data/memory` tree as Hera.
- `installWithBuild()` stops at first failed step and returns captured stdout/stderr per step.
- Team plugin names are normalized via helper functions before package generation.

## ANTI-PATTERNS

- Do not generate plugins that require Hera runtime for basic agent registration.
- Do not skip user skill embedding; built-ins are embedded automatically but resolved user skills must be passed.
- Do not run auto-install steps without surfacing which step failed.
- Do not hard-code `/path/to/...` in installed output paths except placeholder INSTALL templates.

## TESTS

```bash
bun test src/generators/plugin-generator.test.ts
bun test src/generators/team-plugin-generator.test.ts
bun test src/generators/e2e-build.test.ts
```
