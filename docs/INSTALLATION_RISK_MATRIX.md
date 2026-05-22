# Installation Risk Matrix

Hera is an OpenCode plugin. Installation quality is measured by whether a user can add the plugin to OpenCode, verify it with `hera doctor`, and start `opencode --agent hera` without treating Hera as a separate platform.

## Product Boundary

Hera is:

- An OpenCode plugin package.
- A set of OpenCode tools, agents, skills, memory, teams, workflows, and plugin export helpers.
- Installed into the OpenCode config/package context.

Hera is not:

- A standalone agent platform.
- A Claude Code replacement.
- An OpenCode replacement.
- A server runtime that users must operate separately.

## Installation Paths and Risk

| Path | User Requirement | Risk | Recommended Use | Verification |
|------|------------------|------|-----------------|--------------|
| npm install | Node.js/npm + OpenCode | Low | Default public install path | `node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor` |
| Linux one-shot | Node.js/npm + OpenCode | Low-Medium | Linux quickstart and demos | same as npm path |
| Bun install | Bun + OpenCode | Medium | Users who already use Bun | `bun run ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor` |
| Manual tarball | npm available on target, tarball copied in | Low-Medium | Internal networks/offline installs | `npm install --prefix ~/.config/opencode /path/to/hera-agent-<version>.tgz` then doctor |
| Manual source | Git checkout + build tooling | High | Contributors/dev builds only | `npm run build`, then install local path |
| `hera install` CLI | `hera` command already available | Medium | Repair/install helper, not primary onboarding | Should prefer npm and fallback to Bun |

## Known Failure Modes

| Failure | Likely Cause | Correct Response |
|---------|--------------|------------------|
| `bun: command not found` | User followed old Bun-only docs | Use npm path; Bun is optional |
| `npm: command not found` | Node.js not installed | Install Node.js LTS first |
| package installs but Hera not visible | OpenCode did not reload plugin config | Restart OpenCode or run `opencode agent reload` if supported |
| `opencode.json` not updated | postinstall lacked permissions or config was invalid JSON | Manually add `"hera-agent"` to plugin array |
| `dist/index.js` missing | broken package/build output | Reinstall package; verify `npm pack --dry-run` includes dist |
| works on dev machine only | source install accidentally required Bun/build tools | Prefer published npm package or tarball |

## Required Pre-Launch Install Checks

Run these before claiming install readiness:

```bash
# Build/package integrity
bun run typecheck
bun run lint
bun test
bun run build
Test-Path dist/index.d.ts
npm pack --dry-run
```

Then verify at least these user paths:

```bash
# npm path
mkdir -p ~/.config/opencode
npm install --prefix ~/.config/opencode hera-agent
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor

# manual tarball path
npm pack hera-agent
npm install --prefix ~/.config/opencode /path/to/hera-agent-<version>.tgz
node ~/.config/opencode/node_modules/hera-agent/bin/hera.js doctor
```

## Messaging Rule

Do not say "install the Hera platform".

Use:

- "Install the Hera OpenCode plugin."
- "Add Hera to your OpenCode config."
- "Verify the OpenCode plugin with `hera doctor`."

Avoid:

- "Run the Hera platform."
- "Start the Hera server."
- "Replace OpenCode with Hera."
- "Use Hera instead of Claude Code."
