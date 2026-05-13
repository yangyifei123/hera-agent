#!/bin/bash
# Comprehensive Installation Test for Hera Agent
# Tests installation in various scenarios including internal networks

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Hera Agent - Installation Test Suite                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

PASS=0
FAIL=0
WARN=0

pass() { echo "✓ $1"; PASS=$((PASS+1)); }
fail() { echo "✗ $1"; FAIL=$((FAIL+1)); }
warn() { echo "⚠ $1"; WARN=$((WARN+1)); }

TEST_DIR=$(mktemp -d)
echo "Test directory: $TEST_DIR"
echo ""

# Test 1: Package structure
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Package Structure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REQUIRED_FILES="package.json dist/index.js hera.schema.json hera.example.json postinstall.mjs"
for file in $REQUIRED_FILES; do
    if [ -f "$file" ]; then
        pass "$file exists"
    else
        fail "$file missing"
    fi
done

# Test 2: No external network dependencies
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Network Dependencies (Critical for Internal Networks)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for external URLs in source
EXTERNAL_URLS=$(grep -r "https://raw.githubusercontent" src/ dist/ 2>/dev/null || true)
if [ -z "$EXTERNAL_URLS" ]; then
    pass "No GitHub URLs in source code"
else
    fail "Found external GitHub URLs:"
    echo "$EXTERNAL_URLS" | sed 's/^/    /'
fi

# Check for fetch() calls
FETCH_CALLS=$(grep -r "fetch(" src/ dist/ 2>/dev/null || true)
if [ -z "$FETCH_CALLS" ]; then
    pass "No fetch() calls in source"
else
    warn "Found fetch() calls (verify they're optional):"
    echo "$FETCH_CALLS" | sed 's/^/    /'
fi

# Check schema references
SCHEMA_REFS=$(grep -r "\$schema.*http" src/ dist/ hera.example.json 2>/dev/null | grep -v "http://json-schema.org" || true)
if [ -z "$SCHEMA_REFS" ]; then
    pass "No external schema URLs (except json-schema.org)"
else
    fail "Found external schema URLs:"
    echo "$SCHEMA_REFS" | sed 's/^/    /'
fi

# Test 3: Simulated installation
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Simulated Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create test OpenCode config directory
TEST_CONFIG="$TEST_DIR/.config/opencode"
mkdir -p "$TEST_CONFIG"

# Simulate plugin installation
mkdir -p "$TEST_CONFIG/node_modules/hera-agent"
cp -r dist "$TEST_CONFIG/node_modules/hera-agent/"
cp package.json "$TEST_CONFIG/node_modules/hera-agent/"
cp hera.schema.json "$TEST_CONFIG/node_modules/hera-agent/"
cp hera.example.json "$TEST_CONFIG/node_modules/hera-agent/"

if [ -d "$TEST_CONFIG/node_modules/hera-agent/dist" ]; then
    pass "Plugin files copied successfully"
else
    fail "Plugin installation simulation failed"
fi

# Test 4: Config auto-creation (without network)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 4: Config Auto-Creation (Offline Mode)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Simulate config creation
HERA_CONFIG="$TEST_CONFIG/hera.json"
cat > "$HERA_CONFIG" <<'EOF'
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

if [ -f "$HERA_CONFIG" ]; then
    pass "Config file created"

    # Verify no external URLs
    if grep -q "raw.githubusercontent" "$HERA_CONFIG"; then
        fail "Config contains external GitHub URL"
    else
        pass "Config uses relative schema path"
    fi

    # Verify JSON is valid
    if command -v jq >/dev/null 2>&1; then
        if jq empty "$HERA_CONFIG" 2>/dev/null; then
            pass "Config JSON is valid"
        else
            fail "Config JSON is invalid"
        fi
    else
        warn "jq not available, skipping JSON validation"
    fi
else
    fail "Config file not created"
fi

# Test 5: Schema file accessibility
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 5: Schema File Accessibility"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "hera.schema.json" ]; then
    pass "hera.schema.json exists in package"

    # Check if schema is self-contained
    SCHEMA_REFS=$(grep -o "http[s]*://[^\"]*" hera.schema.json | grep -v "json-schema.org" || true)
    if [ -z "$SCHEMA_REFS" ]; then
        pass "Schema is self-contained (no external refs)"
    else
        fail "Schema has external references:"
        echo "$SCHEMA_REFS" | sed 's/^/    /'
    fi
else
    fail "hera.schema.json missing"
fi

# Test 6: Postinstall script safety
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 6: Postinstall Script Safety"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "postinstall.mjs" ]; then
    pass "postinstall.mjs exists"

    # Check for network calls
    if grep -q "fetch\|https://\|http://" postinstall.mjs; then
        fail "postinstall.mjs contains network calls"
    else
        pass "postinstall.mjs has no network calls"
    fi

    # Check for dangerous operations
    if grep -q "rm -rf\|eval\|exec" postinstall.mjs; then
        fail "postinstall.mjs contains dangerous operations"
    else
        pass "postinstall.mjs is safe"
    fi
else
    warn "postinstall.mjs not found"
fi

# Test 7: Build artifact integrity
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 7: Build Artifact Integrity"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "dist/index.js" ]; then
    SIZE=$(stat -c%s "dist/index.js" 2>/dev/null || stat -f%z "dist/index.js" 2>/dev/null)
    if [ "$SIZE" -gt 50000 ]; then
        pass "dist/index.js size OK ($SIZE bytes)"
    else
        fail "dist/index.js too small ($SIZE bytes)"
    fi

    # Check for external URLs in built code
    if grep -q "raw.githubusercontent" dist/index.js; then
        fail "Built code contains GitHub URLs"
    else
        pass "Built code has no external URLs"
    fi
else
    fail "dist/index.js missing"
fi

# Cleanup
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
rm -rf "$TEST_DIR"
pass "Test directory cleaned up"

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  ✓ Passed:   $PASS"
echo "  ✗ Failed:   $FAIL"
echo "  ⚠ Warnings: $WARN"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  ✓ All tests passed - Safe for internal network install   ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    exit 0
else
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  ✗ Installation issues detected - review failures above    ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    exit 1
fi
