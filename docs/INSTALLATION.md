# Installation Guide

Hera can be installed several ways. If Bun fails on your machine, use the npm path first. Bun is supported, but it is not required for installing the published package.

## Recommended: npm / Node.js (No Bun Required)

Use this when users report `bun add` failures or do not want to install Bun.

### Linux/macOS

```bash
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode"
npm install --prefix "$env:USERPROFILE\.config\opencode" hera-agent
node "$env:USERPROFILE\.config\opencode\node_modules\hera-agent\bin\hera.js" doctor
```

What this does:

1. Installs `hera-agent` into the OpenCode config directory.
2. Runs `postinstall.mjs`, which creates Hera data directories.
3. Adds `hera-agent` to `opencode.json` when possible.
4. Lets you verify with `node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor`.

## Linux One-Shot Install

```bash
set -e
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
opencode agent list | grep hera || true
```

If `opencode agent list` does not show Hera immediately, restart OpenCode or run `opencode agent reload` if your OpenCode version supports it.

## Bun Install (Supported, Not Required)

```bash
# Linux/macOS
cd ~/.config/opencode
bun add hera-agent
bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

```powershell
# Windows PowerShell
Set-Location "$env:USERPROFILE\.config\opencode"
bun add hera-agent
bun run "$env:USERPROFILE\.config\opencode\node_modules\hera-agent\bin\hera.js" doctor
```

If this fails with `bun: command not found` or package resolution errors, use the npm method above.

## pnpm / yarn Alternatives

```bash
# pnpm
mkdir -p ~/.config/opencode
cd ~/.config/opencode
pnpm add hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor

# yarn
mkdir -p ~/.config/opencode
cd ~/.config/opencode
yarn add hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

## Manual Tarball Install (Offline/Internal Networks)

Use this when the target machine cannot reach npm or Bun registries.

### Step 1: Create the tarball on an online machine

```bash
npm pack hera-agent
# Produces hera-agent-<version>.tgz
```

### Step 2: Copy the tarball to the target machine

Use USB, internal artifact storage, SCP, or any approved transfer method.

### Step 3: Install from the local file

```bash
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode /path/to/hera-agent-<version>.tgz
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

This method does not require Bun and can work fully offline once the tarball is available.

## Manual Source Install

Use this when you want to install a local checkout rather than the npm package.

```bash
git clone https://github.com/yangyifei123/hera-agent.git
cd hera-agent
npm install
npm run build

mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode /path/to/hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Notes:

- `npm run build` uses the package build script. It may require Bun for development builds because this repository uses Bun to bundle TypeScript.
- If you want a no-Bun install path, prefer the published npm package or tarball method.

## Manual Configuration Fallback

If `postinstall.mjs` cannot update `opencode.json`, add Hera manually.

Open `~/.config/opencode/opencode.json` and ensure it includes:

```json
{
  "plugin": [
    "hera-agent"
  ]
}
```

If the file already has a `plugin` array, add `"hera-agent"` to the existing array instead of replacing it.

Then create the basic directories:

```bash
mkdir -p ~/.config/opencode/hera-data/memory
mkdir -p ~/.config/opencode/hera-data/skills
mkdir -p ~/.config/opencode/hera-data/backups
mkdir -p ~/.config/opencode/agents/hera
```

## Verification

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
opencode agent list | grep hera
```

Expected:

```text
hera (primary)
```

If Hera does not appear, restart OpenCode and verify that `opencode.json` includes `hera-agent`.

## Update

Use npm by default, matching the recommended install path:

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js update --run
# or manually:
npm update --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Force reinstall the latest published version:

```bash
npm uninstall --prefix ~/.config/opencode hera-agent
npm install --prefix ~/.config/opencode hera-agent@latest
```

Install a specific version or roll back:

```bash
npm install --prefix ~/.config/opencode hera-agent@<version>
```

If you installed with Bun, `cd ~/.config/opencode && bun update hera-agent` is still supported.

## Uninstall

Keep agents, skills, and memory for a later reinstall:

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js uninstall --run
# or manually:
npm uninstall --prefix ~/.config/opencode hera-agent
# Remove "hera-agent" from ~/.config/opencode/opencode.json plugin array if needed.
```

Full uninstall, including Hera-created data. The automated command requires explicit confirmation with `--yes`:

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js uninstall --run --purge --yes
# or manually:
npm uninstall --prefix ~/.config/opencode hera-agent
rm -rf ~/.config/opencode/hera-data/
rm -rf ~/.config/opencode/agents/hera/
rm -f ~/.config/opencode/hera.json
```

On Windows PowerShell, replace `~/.config/opencode` with `$env:USERPROFILE\.config\opencode` and use `Remove-Item -Recurse -Force` for the data directories.

## Troubleshooting

### `bun: command not found`

Use npm instead:

```bash
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
```

### `npm: command not found`

Install Node.js LTS first, then retry the npm path.

Linux examples:

```bash
# Ubuntu/Debian via NodeSource
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
npm --version
```

### `opencode: command not found`

Hera is an OpenCode plugin, so `opencode` must be installed and available on PATH before Hera can run inside OpenCode.

1. Install OpenCode from https://github.com/opencode-ai/opencode.
2. Open a new terminal so PATH changes take effect.
3. Verify:

```bash
opencode --version
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

Windows PowerShell:

```powershell
opencode --version
node "$env:USERPROFILE\.config\opencode\node_modules\hera-agent\bin\hera.js" doctor
```

If `npm install --prefix` did not place `hera` on PATH, use the explicit `node .../bin/hera.js` command above for doctor/update/uninstall.

### Config file not created

Manually create the config:

```bash
cd ~/.config/opencode
cat > hera.json <<'EOF'
{
  "$schema": "./hera.schema.json",
  "disabled_agents": [],
  "disabled_skills": [],
  "disabled_tools": [],
  "agent_overrides": {},
  "templates": {},
  "auto_evolve": false,
  "memory_limit": 1000,
  "team_defaults": {
    "coordination": "parallel",
    "timeout": 300000
  }
}
EOF
```

### Plugin not loading

Check 1: `opencode.json` includes Hera:

```bash
cat ~/.config/opencode/opencode.json | grep hera-agent
```

Check 2: build artifacts exist:

```bash
ls ~/.config/opencode/node_modules/hera-agent/dist/index.js
ls ~/.config/opencode/node_modules/hera-agent/dist/index.d.ts
```

Check 3: run doctor:

```bash
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

## Network Requirements

**v2.0.0+**: zero runtime network dependencies.

- No external URLs in runtime code.
- Schema uses relative paths.
- Offline/internal network installs are supported through the tarball method.

## Platform Support

- Windows
- Linux
- macOS
- Internal networks / air-gapped environments through tarball installation

## Next Steps

1. Start Hera: `opencode --agent hera`
2. Create your first agent: see [Quick Start](../README.md#quick-start)
3. Run the demo: see [Canonical Demo](CANONICAL_DEMO.md)

## Installation Risk Matrix

For failure modes, plugin-boundary rules, and pre-launch install checks, see [INSTALLATION_RISK_MATRIX.md](INSTALLATION_RISK_MATRIX.md). For verified smoke-test results, see [INSTALLATION_MATRIX.md](INSTALLATION_MATRIX.md).

## Support

- Issues: https://github.com/yangyifei123/hera-agent/issues
- Documentation: see [README.md](../README.md)
- Changelog: see [CHANGELOG.md](../CHANGELOG.md)
