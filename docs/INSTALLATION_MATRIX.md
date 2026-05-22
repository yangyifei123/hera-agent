# Installation Matrix

This file records the installation paths that have been verified or still need external OS coverage. Hera remains an OpenCode plugin; every install path targets the OpenCode config/package directory, not a separate Hera runtime.

## Verified Locally

| Date | Environment | Method | Command Shape | Result | Notes |
|------|-------------|--------|---------------|--------|-------|
| 2026-05-22 | Windows temp profile, isolated OpenCode config | Local npm tarball with explicit prefix | `npm install --prefix <temp>/.config/opencode hera-agent-2.2.0.tgz` | PASS | `node <temp>/.config/opencode/node_modules/hera-agent/bin/hera.js doctor` returned 5 passed / 0 failed |

Verified artifacts in the isolated install:

- `opencode.json` created and contains `hera-agent`
- `node_modules/hera-agent/dist/index.js` exists
- `node_modules/hera-agent/dist/index.d.ts` exists
- `node_modules/hera-agent/docs/INSTALLATION.md` exists
- `node_modules/hera-agent/docs/INSTALLATION_RISK_MATRIX.md` exists
- `hera-data/` exists
- `agents/hera/` exists

## Why `npm --prefix` Is Recommended

Using `npm install --prefix ~/.config/opencode hera-agent` makes the target install directory explicit. This avoids failures caused by shell working-directory differences, npm workspace detection, or running the command from a repository that already has its own `package.json`.

Prefer this in public docs:

```bash
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Avoid documenting this as the only path:

```bash
cd ~/.config/opencode
npm install hera-agent
```

It can work, but `--prefix` is more explicit and easier to diagnose.

## Still Needed Before Claiming Full Install Hardening

| Environment | Method | Status |
|-------------|--------|--------|
| Ubuntu fresh VM/container | npm prefix install from npm registry | Not yet externally verified |
| Ubuntu fresh VM/container | manual tarball install | Not yet externally verified |
| macOS fresh machine | npm prefix install | Not yet externally verified |
| Windows PowerShell fresh profile | npm prefix install from npm registry | Not yet externally verified |
| Windows PowerShell fresh profile | manual tarball install | Locally simulated with temp profile, but not fresh OS |
| malformed `opencode.json` | postinstall fallback behavior | Not yet externally verified |
| no OpenCode installed | docs/doctor guidance clarity | Not yet externally verified |

## Acceptance Criteria for Future Release Claims

Do not claim installation is fully hardened until at least:

1. npm prefix install passes on Linux, macOS, and Windows.
2. manual tarball install passes on at least Linux and Windows.
3. `hera doctor` returns actionable messages for missing/invalid `opencode.json`.
4. docs continue to describe Hera as an OpenCode plugin, not a platform.
