# Installation Guide

## Quick Install (Recommended)

```bash
opencode plugin hera-agent --global -f
```

That's it! Hera will automatically create `~/.config/opencode/hera.json` on first load.

## Manual Installation

```bash
cd ~/.config/opencode
bun add hera-agent
```

Then add to `opencode.json`:

```json
{
  "plugin": [
    "hera-agent"
  ]
}
```

## Internal Network / Offline Installation

Hera v2.0.0+ is fully compatible with internal networks and offline environments.

### Method 1: From tarball

```bash
# On a machine with internet access
npm pack hera-agent

# Transfer hera-agent-2.0.0.tgz to internal network

# On internal network machine
cd ~/.config/opencode
bun add ./hera-agent-2.0.0.tgz
```

### Method 2: From local directory

```bash
# Clone or copy the repository
git clone https://github.com/yangyifei123/hera-agent.git
cd hera-agent
bun install
bun run build

# Install locally
cd ~/.config/opencode
bun add file:///path/to/hera-agent
```

### Verification

After installation, verify Hera is loaded:

```bash
opencode agent list | grep hera
```

You should see:
```
hera (primary)
```

## Troubleshooting

### Issue: "fetch() cannot be empty string"

**Cause**: Older versions (< 2.0.0) had a GitHub URL in the config schema that failed in internal networks.

**Solution**: Upgrade to v2.0.0 or later:

```bash
cd ~/.config/opencode
bun remove hera-agent
bun add hera-agent@latest
```

### Issue: Config file not created

**Cause**: Permission issues or missing directory.

**Solution**: Manually create the config:

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

### Issue: Plugin not loading

**Check 1**: Verify `opencode.json` includes hera-agent:

```bash
cat ~/.config/opencode/opencode.json | grep hera-agent
```

**Check 2**: Verify build artifacts exist:

```bash
ls ~/.config/opencode/node_modules/hera-agent/dist/index.js
```

**Check 3**: Check for errors:

```bash
opencode --verbose
```

## Network Requirements

**v2.0.0+**: ✅ **Zero network dependencies**
- No external URLs in runtime code
- Schema uses relative paths
- Fully offline compatible

**v1.x**: ⚠️ Required GitHub access for schema validation

## Platform Support

- ✅ Windows (tested on Windows 11)
- ✅ Linux (tested on Ubuntu 22.04)
- ✅ macOS (tested on macOS 14)
- ✅ Internal networks / Air-gapped environments

## Next Steps

After installation:

1. **Start Hera**: `opencode --agent hera`
2. **Create your first agent**: See [Quick Start](../README.md#quick-start)
3. **Explore templates**: `hera_list_agents`

## Support

- **Issues**: https://github.com/yangyifei123/hera-agent/issues
- **Documentation**: See [README.md](../README.md)
- **Changelog**: See [CHANGELOG.md](../CHANGELOG.md)
