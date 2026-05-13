#!/bin/sh
# Comprehensive Portability Analysis for Hera Agent
# Tests installation, configuration, and runtime behavior without Docker

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Hera Agent - Comprehensive Portability Analysis       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

PASS=0
FAIL=0
WARN=0

pass() { echo "✓ $1"; PASS=$((PASS+1)); }
fail() { echo "✗ $1"; FAIL=$((FAIL+1)); }
warn() { echo "⚠ $1"; WARN=$((WARN+1)); }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Build Artifacts & Package Integrity"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check dist/index.js
if [ -f "dist/index.js" ]; then
    SIZE=$(stat -c%s "dist/index.js" 2>/dev/null || stat -f%z "dist/index.js" 2>/dev/null)
    if [ "$SIZE" -gt 50000 ]; then
        pass "dist/index.js exists ($SIZE bytes)"
    else
        fail "dist/index.js too small ($SIZE bytes)"
    fi
else
    fail "dist/index.js missing"
fi

# Check package.json
if [ -f "package.json" ]; then
    VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    pass "package.json v$VERSION"
else
    fail "package.json missing"
fi

# Check required files in package
REQUIRED_FILES="hera.schema.json hera.example.json postinstall.mjs"
for file in $REQUIRED_FILES; do
    if [ -f "$file" ]; then
        pass "$file present"
    else
        fail "$file missing"
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Hardcoded Model References (Critical)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check source files
HARDCODED_SRC=$(grep -r "cherry/GLM" src/ 2>/dev/null || true)
if [ -z "$HARDCODED_SRC" ]; then
    pass "No hardcoded models in src/"
else
    fail "Found hardcoded models in src/:"
    echo "$HARDCODED_SRC" | sed 's/^/    /'
fi

# Check schema
if grep -q '"default".*:.*"cherry/GLM' hera.schema.json 2>/dev/null; then
    fail "Hardcoded model default in hera.schema.json"
else
    pass "No hardcoded model in hera.schema.json"
fi

# Check example config
if grep -q '"default_model".*:.*"cherry/GLM' hera.example.json 2>/dev/null; then
    fail "Hardcoded model in hera.example.json"
else
    pass "No hardcoded model in hera.example.json"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. Platform-Specific Code"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for hardcoded Windows paths
WIN_PATHS=$(grep -r "C:\\\\\\\\Users" src/ 2>/dev/null || true)
if [ -z "$WIN_PATHS" ]; then
    pass "No hardcoded Windows paths"
else
    fail "Found hardcoded Windows paths:"
    echo "$WIN_PATHS" | sed 's/^/    /'
fi

# Check for platform detection
if grep -q "process.platform" src/index.ts; then
    pass "Platform detection present"
else
    warn "No platform detection found"
fi

# Check resolveConfigRoot function
if grep -q "resolveConfigRoot" src/index.ts; then
    pass "Config root resolution present"
    # Verify it handles both platforms
    if grep -q "win32" src/index.ts && grep -q "HOME" src/index.ts; then
        pass "Handles Windows and Unix paths"
    else
        warn "Platform handling may be incomplete"
    fi
else
    fail "Config root resolution missing"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. Configuration Auto-Creation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check auto-config logic
if grep -q "writeFile(heraConfigPath" src/index.ts; then
    pass "Auto-config creation code present"
else
    fail "Auto-config creation missing"
fi

# Verify it doesn't require model
if grep -A 20 "writeFile(heraConfigPath" src/index.ts | grep -q '"default_model"'; then
    fail "Auto-config still includes default_model"
else
    pass "Auto-config doesn't force model"
fi

# Check error handling
if grep -q "catch.*hera.json" src/index.ts; then
    pass "Config creation error handling present"
else
    warn "Limited error handling for config"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. Model Configuration Inheritance"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check model fallback chain
if grep -q "config.default_model ?? input.model" src/index.ts; then
    pass "Model inherits from OpenCode config"
else
    warn "Model inheritance may not work"
fi

# Verify no hardcoded fallback
if grep -q "input.model ?? \"cherry" src/index.ts; then
    fail "Still has hardcoded model fallback"
else
    pass "No hardcoded model fallback"
fi

# Check agent registry model handling
if grep -q "config.default_model ?" src/agents/registry.ts; then
    pass "Registry handles optional model"
else
    warn "Registry may require model"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6. Plugin Structure & Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check directory structure
REQUIRED_DIRS="src src/agents src/skills src/tools src/team src/memory src/distillation"
for dir in $REQUIRED_DIRS; do
    if [ -d "$dir" ]; then
        pass "$dir/ exists"
    else
        fail "$dir/ missing"
    fi
done

# Check dependencies
if grep -q "@opencode-ai/plugin" package.json; then
    pass "OpenCode plugin dependency present"
else
    fail "Missing OpenCode plugin dependency"
fi

# Check external declarations in build
if grep -q "external @opencode-ai/plugin" package.json; then
    pass "External dependencies configured"
else
    warn "External dependencies may not be configured"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "7. Documentation Completeness"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REQUIRED_DOCS="README.md CHANGELOG.md LICENSE CLAUDE.md CONTRIBUTING.md"
for doc in $REQUIRED_DOCS; do
    if [ -f "$doc" ]; then
        pass "$doc present"
    else
        fail "$doc missing"
    fi
done

# Check README has installation instructions
if grep -q "opencode plugin hera-agent" README.md; then
    pass "Installation instructions in README"
else
    warn "Installation instructions may be incomplete"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "8. Build & Syntax Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test build
if bun build src/index.ts --outdir /tmp/hera-test-build --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk > /tmp/hera-build.log 2>&1; then
    pass "Plugin builds successfully"
else
    fail "Plugin build failed (see /tmp/hera-build.log)"
fi

# Check TypeScript types
if [ -f "tsconfig.json" ]; then
    pass "TypeScript config present"
else
    warn "No TypeScript config"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "9. Installation Simulation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check postinstall script
if [ -f "postinstall.mjs" ]; then
    pass "postinstall.mjs exists"
    if grep -q "hera.md" postinstall.mjs; then
        pass "Postinstall creates hera.md"
    else
        warn "Postinstall may not create hera.md"
    fi
else
    warn "No postinstall script"
fi

# Check package.json scripts
if grep -q '"postinstall"' package.json; then
    pass "Postinstall hook configured"
else
    warn "No postinstall hook"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "10. Security & Best Practices"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for sensitive data
if grep -r "password\|secret\|token" src/ | grep -v "// " | grep -v "description" > /dev/null 2>&1; then
    warn "Potential sensitive data references found"
else
    pass "No obvious sensitive data"
fi

# Check license
if [ -f "LICENSE" ]; then
    if grep -q "MIT" LICENSE; then
        pass "MIT License present"
    else
        warn "Non-MIT license"
    fi
else
    fail "No LICENSE file"
fi

# Check for eval or dangerous functions
if grep -r "eval(" src/ > /dev/null 2>&1; then
    warn "Found eval() usage"
else
    pass "No eval() usage"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  ✓ Passed:  $PASS"
echo "  ✗ Failed:  $FAIL"
echo "  ⚠ Warnings: $WARN"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  ✓ Hera Agent is PORTABLE and ready for distribution      ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    exit 0
else
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  ✗ Portability issues detected - review failures above    ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    exit 1
fi
