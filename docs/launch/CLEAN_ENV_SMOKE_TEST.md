# Clean Environment Smoke Test

> Goal: prove a new user can install Hera as an OpenCode plugin, verify it, create an agent, create a team, and clean up without relying on this development checkout.

Run this after `hera-agent@2.2.0` is published to npm. Until npm publish succeeds, use the tarball fallback section.

## Pass Criteria

- `hera-agent` installs into the OpenCode config directory with npm `--prefix`.
- `hera doctor` reports all checks passed.
- Hera appears as an OpenCode agent after OpenCode reload/restart.
- A `mode: all` agent can be created and invoked.
- A team can be created, listed, messaged, and deleted.
- A team can be created with a workflow recipe and the recipe shows up in team status.
- Team shared workspace / blackboard can store and recall one item.
- Uninstall removes the package while preserving data by default.

## Test Matrix

| Environment | Install Method | Status | Notes |
|-------------|----------------|--------|-------|
| Windows PowerShell fresh profile | npm registry prefix install | Pending npm publish | Highest priority because current dev host is Windows. |
| Ubuntu fresh VM/container | npm registry prefix install | Pending npm publish | Use a clean HOME. |
| macOS fresh user/profile | npm registry prefix install | Pending npm publish | External tester needed. |
| Windows temp profile | local tarball install | Previously simulated | Keep as fallback coverage. |
| Ubuntu fresh VM/container | local tarball install | Pending | Validates offline/internal-network path. |

## Registry Install: Linux/macOS

Use a clean user account, VM, container, or temporary HOME.

```bash
export HERA_SMOKE_HOME="$(mktemp -d)"
export HOME="$HERA_SMOKE_HOME"

mkdir -p "$HOME/.config/opencode"
npm install --prefix "$HOME/.config/opencode" hera-agent
node "$HOME/.config/opencode/node_modules/hera-agent/bin/hera.js" doctor
```

Expected doctor result:

```text
All checks passed. Hera is healthy.
```

Then run the OpenCode path:

```bash
opencode run --agent hera "create smoke-reviewer, mode: all, template: coder"
opencode --agent smoke-reviewer "Say 'hera smoke agent ok' and recall any Hera project memory if available."
opencode run --agent hera "create smoke-team with smoke-reviewer and bug-hunter, mode: parallel"
opencode run --agent hera "set team smoke-team workflow: recipe"
opencode run --agent hera "list teams"
opencode run --agent hera "remember in smoke-team: smoke channel passed registry install"
opencode run --agent hera "recall smoke-team memory: registry install"
opencode run --agent hera "delete smoke-team"
opencode run --agent hera "delete smoke-reviewer"
```

Cleanup:

```bash
npm uninstall --prefix "$HOME/.config/opencode" hera-agent
```

## Registry Install: Windows PowerShell

Use a clean Windows profile if possible. If not, use a temporary config root and set `USERPROFILE` only for the shell running the test.

```powershell
$SmokeHome = Join-Path $env:TEMP "hera-smoke-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $SmokeHome | Out-Null
$env:USERPROFILE = $SmokeHome

New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode" | Out-Null
npm install --prefix "$env:USERPROFILE\.config\opencode" hera-agent
node "$env:USERPROFILE\.config\opencode\node_modules\hera-agent\bin\hera.js" doctor
```

Expected doctor result:

```text
All checks passed. Hera is healthy.
```

Then run:

```powershell
opencode run --agent hera "create smoke-reviewer, mode: all, template: coder"
opencode --agent smoke-reviewer "Say 'hera smoke agent ok'."
opencode run --agent hera "create smoke-team with smoke-reviewer and bug-hunter, mode: parallel"
opencode run --agent hera "list teams"
opencode run --agent hera "delete smoke-team"
opencode run --agent hera "delete smoke-reviewer"
```

Cleanup:

```powershell
npm uninstall --prefix "$env:USERPROFILE\.config\opencode" hera-agent
```

## Tarball Fallback Before npm Publish

Use this while npm authentication blocks registry publishing.

```bash
# From the Hera repo after bun run build
npm pack

# On the clean target machine
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode /path/to/hera-agent-2.2.0.tgz
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Record the result in `docs/INSTALLATION_MATRIX.md` with date, OS, command shape, and pass/fail notes.

## Failure Triage

| Failure | Likely Cause | First Check |
|---------|--------------|-------------|
| `opencode CLI not found in PATH` | OpenCode missing or not exported to PATH | Install OpenCode and reopen shell. |
| `hera-agent` installs but Hera does not appear | OpenCode needs restart/reload | Restart OpenCode or run reload if supported. |
| `dist/index.d.ts` missing | Package/build problem | Stop launch; rerun `bun run build` and `npm pack --dry-run`. |
| `opencode.json` not updated | postinstall could not write config | Use manual config fallback from `docs/INSTALLATION.md`. |
