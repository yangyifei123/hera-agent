# Launch Gate & Runbook

> This document defines the HARD GATES that must pass before any public launch. No exceptions.

## Launch Gates (ALL must pass)

### Gate 1: Technical Quality

```bash
# Run all gates in sequence
cd /path/to/hera-agent

# 1. Format check
bun run format:check
# Expected: clean (no errors)

# 2. Lint
bun run lint
# Expected: clean exit; warnings should be reviewed before broad launch

# 3. Type Check
bun run typecheck
# Expected: clean (no errors)

# 4. Tests
bun test
# Expected: 645+ pass, 0 fail

# 5. Build
bun run build
# Expected: clean exit, dist/index.js and dist/index.d.ts exist

# 6. Pack
npm pack --dry-run
# Expected: includes dist/index.js, dist/index.d.ts, package.json
```

**Pass criteria**: All 6 commands exit 0 with expected output.

### Gate 2: README Conversion

```bash
# Verify README has required sections
grep -c "Why Hera" README.md        # Expected: >= 1
grep -c "2-Minute Demo" README.md   # Expected: >= 1
grep -c "Quick Start" README.md      # Expected: >= 1
grep -c "Troubleshooting" README.md  # Expected: >= 1
```

**Pass criteria**: All grep counts >= 1.

### Gate 3: Governance Baseline

```bash
# Verify governance files exist
test -f CODE_OF_CONDUCT.md && echo "OK" || echo "MISSING"
test -f .github/ISSUE_TEMPLATE/bug_report.yml && echo "OK" || echo "MISSING"
test -f .github/ISSUE_TEMPLATE/feature_request.yml && echo "OK" || echo "MISSING"
test -f .github/PULL_REQUEST_TEMPLATE.md && echo "OK" || echo "MISSING"
test -f CONTRIBUTING.md && echo "OK" || echo "MISSING"
```

**Pass criteria**: All files exist.

### Gate 4: Demo Reproducibility

```bash
# Verify canonical demo document exists
test -f docs/CANONICAL_DEMO.md && echo "OK" || echo "MISSING"

# Verify positioning document exists
test -f docs/POSITIONING.md && echo "OK" || echo "MISSING"
```

**Pass criteria**: Both files exist.

## Incident Response

### Install Failure

| Symptom | Likely Cause | Fix | Owner |
|---------|-------------|-----|-------|
| `bun add hera-agent` fails | npm registry issue | Verify npmjs.com package status, check bun version | Maintainer |
| `hera doctor` shows errors | Build artifact missing | Run `bun run build` in hera-agent dir, verify dist/ | Maintainer |
| Agent not appearing in list | opencode.json not updated | Restart OpenCode, check plugin array | User/Maintainer |
| `fetch() cannot be empty string` | v1.x on internal network | Upgrade to v2.0+ | User |

### Issue Triage SLA

| Severity | Response Time | Resolution Target |
|----------|--------------|-------------------|
| Critical (install broken, data loss) | 4 hours | 24 hours |
| High (agent creation fails) | 24 hours | 72 hours |
| Medium (UX confusion, docs gap) | 48 hours | 1 week |
| Low (feature request, enhancement) | 1 week | Backlog |

### Escalation Path

1. **First response**: Issue triager checks if bug is reproducible
2. **If reproducible**: Maintainer creates fix branch + test
3. **If not reproducible**: Request more info, label "needs-repro"
4. **Security issue**: Follow SECURITY.md disclosure process

### Rollback Plan

If a release causes widespread issues:

1. `npm deprecate hera-agent@<broken-version>` to warn new installs
2. Publish patch release with fix within 24 hours (or revert commit)
3. Post announcement in OpenCode community + GitHub Discussions
4. Update CHANGELOG with incident report

## Launch Checklist

- [ ] Gate 1: Technical quality (all 6 commands pass)
- [ ] Gate 2: README conversion (all sections present)
- [ ] Gate 3: Governance baseline (all files exist)
- [ ] Gate 4: Demo reproducibility (both docs exist)
- [ ] Launch assets ready (show-hn.md, x-thread.md, reddit.md)
- [ ] Discovery map populated
- [ ] Version tag created (v2.2.1)
- [ ] GitHub release draft prepared
- [ ] npm publish completed and `npm view hera-agent version` returns `2.2.1`
- [ ] Clean environment smoke test completed from `docs/launch/CLEAN_ENV_SMOKE_TEST.md`
- [ ] Post-launch monitoring plan defined
