import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createPackageTools } from "./package-tools.js";
import type { PluginContext } from "../types.js";
import { join } from "node:path";
import { mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("Package Tools", () => {
  let testDir: string;
  let ctx: PluginContext;

  beforeEach(async () => {
    testDir = join(tmpdir(), `hera-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Mock context
    ctx = {
      configRoot: testDir,
      store: {} as any,
      agentRegistry: {} as any,
      skillManager: {} as any,
      registeredAgents: new Map(),
    };

    // Set environment variable
    process.env.OPENCODE_CONFIG_ROOT = testDir;
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    delete process.env.OPENCODE_CONFIG_ROOT;
  });

  test("hera_list_packages returns empty list initially", async () => {
    const tools = createPackageTools(ctx);
    const result = await tools.hera_list_packages.execute({});

    expect(result).toContain("No packaged agents found");
  });

  test("hera_package_agent fails for non-existent agent", async () => {
    const tools = createPackageTools(ctx);
    const result = await tools.hera_package_agent.execute({
      name: "non-existent-agent",
    });

    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  test("hera_package_agent packages md mode agent", async () => {
    // Create a test agent .md file
    const agentsDir = join(testDir, "agents", "hera");
    await mkdir(agentsDir, { recursive: true });
    const mdPath = join(agentsDir, "test-agent.md");
    await writeFile(mdPath, "# Test Agent\n\nThis is a test agent.");

    const tools = createPackageTools(ctx);
    const result = await tools.hera_package_agent.execute({
      name: "test-agent",
      includeMemory: false,
    });

    expect(result).toContain("packaged successfully");
    expect(result).toContain("Mode: md");

    // Verify package file exists
    const packageDir = join(testDir, "hera-data", "packages");
    const packagePath = join(packageDir, "test-agent-package.tar.gz");
    const packageStat = await stat(packagePath);
    expect(packageStat.isFile()).toBe(true);
  });

  test("hera_package_agent with custom output name", async () => {
    // Create a test agent .md file
    const agentsDir = join(testDir, "agents", "hera");
    await mkdir(agentsDir, { recursive: true });
    const mdPath = join(agentsDir, "test-agent.md");
    await writeFile(mdPath, "# Test Agent");

    const tools = createPackageTools(ctx);
    const result = await tools.hera_package_agent.execute({
      name: "test-agent",
      includeMemory: false,
      outputName: "custom-name",
    });

    expect(result).toContain("packaged successfully");

    // Verify custom package name
    const packageDir = join(testDir, "hera-data", "packages");
    const packagePath = join(packageDir, "custom-name.tar.gz");
    const packageStat = await stat(packagePath);
    expect(packageStat.isFile()).toBe(true);
  });

  test("hera_unpack_agent fails for non-existent package", async () => {
    const tools = createPackageTools(ctx);
    const result = await tools.hera_unpack_agent.execute({
      packagePath: "/non/existent/package.tar.gz",
    });

    expect(result).toContain("Error");
    expect(result).toContain("not found");
  });

  test("hera_list_packages shows packaged agents", async () => {
    // Create a test package
    const agentsDir = join(testDir, "agents", "hera");
    await mkdir(agentsDir, { recursive: true });
    const mdPath = join(agentsDir, "test-agent.md");
    await writeFile(mdPath, "# Test Agent");

    const tools = createPackageTools(ctx);
    await tools.hera_package_agent.execute({
      name: "test-agent",
      includeMemory: false,
    });

    // List packages
    const result = await tools.hera_list_packages.execute({});

    expect(result).toContain("Packaged agents:");
    expect(result).toContain("test-agent-package.tar.gz");
  });

  test("package and unpack round-trip for md agent", async () => {
    // Create a test agent .md file
    const agentsDir = join(testDir, "agents", "hera");
    await mkdir(agentsDir, { recursive: true });
    const mdPath = join(agentsDir, "test-agent.md");
    const originalContent = "# Test Agent\n\nThis is a test agent with some content.";
    await writeFile(mdPath, originalContent);

    const tools = createPackageTools(ctx);

    // Package the agent
    const packageResult = await tools.hera_package_agent.execute({
      name: "test-agent",
      includeMemory: false,
    });
    expect(packageResult).toContain("packaged successfully");

    // Delete the original .md file
    await rm(mdPath);

    // Unpack the agent
    const packagePath = join(testDir, "hera-data", "packages", "test-agent-package.tar.gz");
    const unpackResult = await tools.hera_unpack_agent.execute({
      packagePath,
      installPlugin: false,
    });
    expect(unpackResult).toContain("unpacked successfully");

    // Verify the .md file was restored
    const restoredContent = await readFile(mdPath, "utf-8");
    expect(restoredContent).toBe(originalContent);
  });

  test("hera_package_agent includes memory when requested", async () => {
    // Create a test agent .md file
    const agentsDir = join(testDir, "agents", "hera");
    await mkdir(agentsDir, { recursive: true });
    const mdPath = join(agentsDir, "test-agent.md");
    await writeFile(mdPath, "# Test Agent");

    // Create some memory files mentioning the agent
    const memoryDir = join(testDir, "hera-data", "memory", "agents");
    await mkdir(memoryDir, { recursive: true });
    const memoryFile = join(memoryDir, "test-memory.json");
    await writeFile(
      memoryFile,
      JSON.stringify({
        id: "test-1",
        type: "agent",
        content: "Memory about test-agent",
        timestamp: Date.now(),
      })
    );

    const tools = createPackageTools(ctx);
    const result = await tools.hera_package_agent.execute({
      name: "test-agent",
      includeMemory: true,
    });

    expect(result).toContain("packaged successfully");
    expect(result).toContain("Memory included: true");
  });
});
