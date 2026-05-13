#!/bin/sh
set -e

echo "=== Hera Portability Test ==="
echo ""

# Test 1: Check build artifacts
echo "Test 1: Checking build artifacts..."
if [ -f "dist/index.js" ]; then
    echo "✓ dist/index.js exists"
    SIZE=$(stat -c%s "dist/index.js" 2>/dev/null || stat -f%z "dist/index.js" 2>/dev/null || echo "0")
    echo "  Size: $SIZE bytes"
else
    echo "✗ dist/index.js missing"
    exit 1
fi

# Test 2: Check package.json
echo ""
echo "Test 2: Checking package.json..."
if [ -f "package.json" ]; then
    echo "✓ package.json exists"
    VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    echo "  Version: $VERSION"
else
    echo "✗ package.json missing"
    exit 1
fi

# Test 3: Check schema files
echo ""
echo "Test 3: Checking schema files..."
if [ -f "hera.schema.json" ]; then
    echo "✓ hera.schema.json exists"
    # Check if default_model has no hardcoded default
    if grep -q '"default": "cherry/GLM' hera.schema.json; then
        echo "✗ Found hardcoded model in schema!"
        exit 1
    else
        echo "  No hardcoded model defaults ✓"
    fi
else
    echo "✗ hera.schema.json missing"
    exit 1
fi

# Test 4: Check example config
echo ""
echo "Test 4: Checking example config..."
if [ -f "hera.example.json" ]; then
    echo "✓ hera.example.json exists"
    # Check if it has hardcoded model
    if grep -q '"default_model".*:.*"cherry/GLM' hera.example.json; then
        echo "✗ Found hardcoded model in example!"
        exit 1
    else
        echo "  No hardcoded model ✓"
    fi
else
    echo "✗ hera.example.json missing"
    exit 1
fi

# Test 5: Check source files for hardcoded models
echo ""
echo "Test 5: Checking source files for hardcoded models..."
HARDCODED=$(grep -r "cherry/GLM" src/ || true)
if [ -n "$HARDCODED" ]; then
    echo "✗ Found hardcoded models in source:"
    echo "$HARDCODED"
    exit 1
else
    echo "✓ No hardcoded models in source files"
fi

# Test 6: Verify plugin structure
echo ""
echo "Test 6: Verifying plugin structure..."
REQUIRED_DIRS="src src/agents src/skills src/tools src/team src/memory src/distillation"
for dir in $REQUIRED_DIRS; do
    if [ -d "$dir" ]; then
        echo "✓ $dir exists"
    else
        echo "✗ $dir missing"
        exit 1
    fi
done

# Test 7: Check documentation
echo ""
echo "Test 7: Checking documentation..."
REQUIRED_DOCS="README.md CHANGELOG.md LICENSE CLAUDE.md"
for doc in $REQUIRED_DOCS; do
    if [ -f "$doc" ]; then
        echo "✓ $doc exists"
    else
        echo "✗ $doc missing"
        exit 1
    fi
done

# Test 8: Simulate plugin loading (basic syntax check)
echo ""
echo "Test 8: Testing plugin syntax..."
if bun build src/index.ts --outdir /tmp/test-build --target bun --format esm --external @opencode-ai/plugin --external @opencode-ai/sdk > /dev/null 2>&1; then
    echo "✓ Plugin builds successfully"
else
    echo "✗ Plugin build failed"
    exit 1
fi

# Test 9: Check for platform-specific code
echo ""
echo "Test 9: Checking platform compatibility..."
if grep -r "C:\\\\Users" src/ > /dev/null 2>&1; then
    echo "✗ Found Windows-specific hardcoded paths"
    exit 1
else
    echo "✓ No hardcoded Windows paths"
fi

# Test 10: Verify config auto-creation logic
echo ""
echo "Test 10: Checking config auto-creation..."
if grep -q "writeFile(heraConfigPath" src/index.ts; then
    echo "✓ Auto-config creation code present"
else
    echo "✗ Auto-config creation missing"
    exit 1
fi

echo ""
echo "=== All Portability Tests Passed ✓ ==="
echo ""
echo "Summary:"
echo "- Build artifacts: OK"
echo "- No hardcoded models: OK"
echo "- Plugin structure: OK"
echo "- Documentation: OK"
echo "- Platform compatibility: OK"
echo "- Auto-configuration: OK"
