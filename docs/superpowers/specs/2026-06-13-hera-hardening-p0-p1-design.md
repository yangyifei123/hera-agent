# Hera P0/P1 Hardening Design

## Goal

Raise Hera from early-production quality toward a stronger production baseline by fixing known P0/P1 reliability gaps before broader architecture work.

This design focuses on trust-critical paths:

- generated plugin correctness
- agent backup and restore recovery
- import/package validation
- config-root environment contract compatibility
- regression tests and real scenario verification

Wave 1 must make advertised flows work and prevent known regressions. Wave 2 follows with larger drift-reduction work.

## Non-goals

- Rewrite the plugin runtime.
- Replace the team system.
- Fully redesign generic workflow execution.
- Break existing user config, agents, skills, packages, or env vars.
- Claim industrial-grade status without passing verification gates.

## Compatibility rule

Migration must be backward compatible.

- `HERA_CONFIG_ROOT` is canonical for main Hera runtime and CLI config-root resolution.
- Legacy aliases may still be read where existing users could depend on them.
- Generated plugin memory helpers may keep `HERA_DIR` compatibility, but docs and new code should make each env var's role explicit.
- New writes and docs use canonical names.
- Old persisted data is normalized on read where feasible.
- Invalid or hostile input is rejected before any install/write side effect.

## Wave 1 scope

### 1. Generated plugin correctness

Problem: generated single-agent plugin code can emit schema declarations that reference `z` while only `_z` is declared. This can create runtime/load failure in generated plugins.

Design:

- Fix generator output so emitted schema variable names are consistent.
- Prefer a single local schema alias convention inside generated files.
- Add regression coverage that inspects or executes generated output enough to catch `z is not defined` class failures.

Touched areas:

- `src/generators/plugin-generator.ts`
- generator tests near source

Acceptance:

- generated plugin output does not reference undeclared schema variables
- regression test fails on old bug, passes after fix

### 2. Backup and restore recovery

Problem: backup path derivation and restore exposure are not trustworthy enough for production recovery. Restore exists in persistence code but is not surfaced as a first-class tool path.

Design:

- Fix backup directory derivation so backups land under the intended Hera data tree next to other runtime data.
- Add restore/list-backups tools to expose recovery through the normal Hera tool surface.
- Validate agent names and timestamps before reading backup paths.
- Restore through `persistAgent()` so memory, disk, and live registry stay synchronized.
- Use skill map from the runtime context during restore so restored disk Markdown includes known skill data where possible.

Touched areas:

- `src/persistence.ts`
- `src/tools/agent-tools.ts`
- tests near persistence/tool source

Acceptance:

- delete creates backup in correct location
- list backups returns expected entries
- restore latest backup works
- restore specific timestamp works or returns clear error
- invalid names/timestamps are rejected without file traversal

### 3. Import validation

Problem: `hera_import_agent` parses arbitrary JSON into an agent definition and persists it without using the same name validation and conflict checks as create paths.

Design:

- Validate imported agent name with `validateAgentNameWithConflict()`.
- Validate required fields before persistence.
- Normalize optional arrays/fields to safe defaults where existing types allow.
- Return clear error messages with suggestions when validation fails.
- Preserve valid import behavior for current users.

Touched areas:

- `src/tools/agent-tools.ts`
- `src/validation.ts` only if helper extraction is needed
- import tests

Acceptance:

- invalid name rejected
- reserved name rejected
- duplicate name rejected
- malformed JSON returns clear error
- valid import still persists to registry, disk, and memory

### 4. Package/unpack safety

Problem: package and unpack flows handle archive input and persisted agent data. These paths need stricter validation before writing to user config directories.

Design:

- Validate package manifests before install/import.
- Reject unsupported package versions with clear messages.
- Ensure archive extraction paths cannot escape staging/install roots.
- Validate imported agent definitions through the same name validation rules.
- Keep successful package/install UX unchanged.

Touched areas:

- `src/tools/package-tools.ts`
- package tests

Acceptance:

- normal package export/import still works
- unsupported manifest version rejected
- missing/malformed manifest rejected
- path traversal entries rejected before write/install
- imported packaged agents use same validation as direct import

### 5. Config-root/env contract

Problem: runtime, CLI, generated plugins, docs, and historical references can imply different env contracts.

Design:

- Treat `HERA_CONFIG_ROOT` as canonical for main Hera/OpenCode config root.
- Keep compatibility aliases only where required by existing code/user behavior.
- Document precedence in code tests and docs.
- Avoid changing generated plugin `HERA_DIR` behavior unless compatibility wrapper makes its contract clearer.

Touched areas:

- `src/constants.ts`
- `bin/hera.js`
- generator helpers if necessary
- docs after code truth settles

Acceptance:

- canonical env works in runtime resolver
- CLI resolver matches runtime precedence
- legacy alias behavior is explicit and tested if kept
- docs no longer imply wrong env variable for logging/config-root

## Wave 1 verification

Every slice should run targeted tests for touched code. End-of-wave gate:

```bash
bun run typecheck
bun run lint
bun run build
bun test
```

Targeted experiments:

1. Restore round-trip: create/import agent, delete, list backup, restore latest, verify registry/disk/memory.
2. Invalid import matrix: bad name, reserved name, duplicate name, malformed JSON.
3. Package safety matrix: valid package, malformed manifest, unsupported version, traversal-like entry.
4. Generated plugin smoke: generate output and verify no undeclared schema variable references.
5. Env matrix: runtime and CLI root resolution agree for canonical and supported legacy envs.

If a gate cannot run because environment/tooling is unavailable, record exact blocker and do not claim pass.

## Wave 2 scope

Wave 2 starts after Wave 1 is green.

### Prompt assembly unification

Problem: persisted Markdown prompt rendering and runtime config-hook prompt assembly can drift.

Design:

- Introduce one canonical prompt composition function or small prompt-parts module.
- Disk rendering and runtime injection consume the same normalized parts.
- Keep sections distinct: base prompt, built-in/user skills, team context, evolution context.
- Add round-trip tests for create, persist, reload, runtime injection, and duplicate prevention.

### Cross-surface rule sharing

Problem: runtime, CLI, generator, docs, and tests duplicate some assumptions.

Design:

- Share small rule helpers where practical.
- Where direct sharing is impractical, add contract tests to enforce equivalence.
- Avoid large rewrites; reduce drift in the areas touched by Wave 1.

### Workflow subsystem hardening

Problem: generic workflow execution has placeholder-like tool-step behavior and needs clearer production contract.

Design:

- Either implement real tool-step execution with explicit constraints or narrow public claims.
- Tighten execution directory and approval semantics.
- Add tests that prove actual execution guarantees, not only bookkeeping.

## Clawteam execution model

Use multi-agent/clawteam style for implementation review and coverage:

- Track A: persistence, backup, restore.
- Track B: import, package, validation.
- Track C: generator, env contract, tests.
- Main thread: integrate, resolve overlaps, run verification, manage git.

Agents should report concrete file changes, tests, and risks. Main thread owns final edits and truth claims.

## Git strategy

Work on branch `hardening-p0-p1`.

Prefer small logical commits:

- `fix: harden backup and restore flow`
- `fix: validate import and package inputs`
- `fix: repair generated plugin schema usage`
- `test: add p0 p1 hardening regressions`

Do not commit a slice until targeted checks for that slice pass or the failure is documented as a blocker.

## Risks and mitigations

- Risk: validation changes reject previously accepted malformed agents.
  - Mitigation: reject only unsafe/invalid inputs; keep valid legacy shapes working.
- Risk: env compatibility adds confusing precedence.
  - Mitigation: one precedence rule, tested in runtime and CLI.
- Risk: restore writes incomplete prompts if skills are not passed.
  - Mitigation: restore through runtime skill map when tool context is available.
- Risk: package traversal tests depend on archive tooling.
  - Mitigation: isolate helper-level path validation tests if full archive construction is too brittle.
- Risk: broad Wave 2 refactor destabilizes Wave 1.
  - Mitigation: keep Wave 1 narrow; start Wave 2 only after green gate.

## Done definition

Wave 1 is done when:

- known P0/P1 issues are fixed
- regression tests cover each issue
- scenario experiments are run or exact blockers are recorded
- release gate commands pass or failures are reported with output
- docs match implemented behavior

Wave 2 is planned separately after Wave 1 result is stable.
