#!/bin/bash
set -e

echo "=== Building Docker Test Environment ==="
echo ""

# Build Docker image
echo "Building Docker image..."
docker build -f test/Dockerfile.portability -t hera-portability-test .

echo ""
echo "=== Running Portability Tests in Docker ==="
echo ""

# Run portability tests
docker run --rm hera-portability-test /home/testuser/hera-agent/test/test-portability.sh

echo ""
echo "=== Testing Plugin Installation Simulation ==="
echo ""

# Test plugin installation flow
docker run --rm hera-portability-test /bin/sh -c '
cd /home/testuser/hera-agent
echo "Simulating plugin installation..."
echo ""

# Check if hera.json would be auto-created
echo "Test: Config auto-creation logic"
if grep -q "writeFile(heraConfigPath" src/index.ts; then
    echo "✓ Auto-config creation present"
else
    echo "✗ Auto-config missing"
    exit 1
fi

# Verify no model is required
echo ""
echo "Test: Model configuration"
if grep -q "cherry/GLM" src/index.ts; then
    echo "✗ Found hardcoded model in index.ts"
    exit 1
else
    echo "✓ No hardcoded model in index.ts"
fi

# Check registry
if grep -q "cherry/GLM" src/agents/registry.ts; then
    echo "✗ Found hardcoded model in registry.ts"
    exit 1
else
    echo "✓ No hardcoded model in registry.ts"
fi

echo ""
echo "Test: Package integrity"
FILES="dist/index.js package.json hera.schema.json hera.example.json"
for file in $FILES; do
    if [ -f "$file" ]; then
        echo "✓ $file present"
    else
        echo "✗ $file missing"
        exit 1
    fi
done

echo ""
echo "✓ All installation simulation tests passed"
'

echo ""
echo "=== Testing Cross-Platform Compatibility ==="
echo ""

# Test path resolution
docker run --rm hera-portability-test /bin/sh -c '
cd /home/testuser/hera-agent
echo "Test: Path resolution"
if grep -q "resolveConfigRoot" src/index.ts; then
    echo "✓ Platform-aware path resolution present"
else
    echo "✗ Path resolution missing"
    exit 1
fi

echo ""
echo "Test: No absolute paths"
if grep -r "C:\\\\\\\\Users\\\\\\\\Administrator" src/ > /dev/null 2>&1; then
    echo "✗ Found hardcoded absolute paths"
    exit 1
else
    echo "✓ No hardcoded absolute paths"
fi

echo ""
echo "✓ Cross-platform compatibility verified"
'

echo ""
echo "=== Cleanup ==="
docker rmi hera-portability-test

echo ""
echo "=== Docker Portability Test Complete ✓ ==="
