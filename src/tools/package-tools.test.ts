import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createPackageTools,
  validateManifest,
  isEntryInsideDir,
} from "./package-tools.js";
import type { PluginContext } from "../types.js";
import type { ToolContext } from "@opencode-ai/plugin";
import { makeTestHarness, type TestHarness } from "./test-harness.js";
import { join } from "node:path";
import { mkdir, writeFile, rm, readFile, stat, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack } from "tar-fs";

/** Build a real .tar.gz from a staging dir, optionally remapping entry names. */
async function makeTarGz(
  stagingDir: string,
  outputPath: string,
  mapEntry?: (name: string) => string
): Promise<void> {
  const packStream = pack(stagingDir, {
    map(header) {
      if (mapEntry) header.name = mapEntry(header.name);
      return header;
    },
  });
  await pipeline(packStream, createGzip(), createWriteStream(outputPath));
}

describe("Package Tools", () => {
  let testDir: string;
  let ctx: PluginContext;
  let toolCtx: ToolContext;
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await makeTestHarness();
    testDir = harness.tmp;
    ctx = harness.ctx;

    toolCtx = {
      sessionID: "test-session",
      messageID: "test-message",
      agent: "hera",
      directory: testDir,
      worktree: testDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: (() => {
        throw new Error("ask is not used in package tool tests");
      }) as ToolContext["ask"],
    };

    // Set environment variable
    process.env.OPENCODE_CONFIG_ROOT = testDir;
  });

  afterEach(async () => {
    await harness.cleanup();
    delete process.env.OPENCODE_CONFIG_ROOT;
  });

  test("hera_list_packages returns empty list initially", async () => {
    const tools = createPackageTools(ctx);
    const result = await tools.hera_list_packages.execute({}, toolCtx);

    expect(result).toContain("No packaged agents found");
  });

  test("hera_package_agent fails for non-existent agent", async () => {
    const tools = createPackageTools(ctx);
    const result = await tools.hera_package_agent.execute(
      {
        name: "non-existent-agent",
      },
      toolCtx
    );

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
    const result = await tools.hera_package_agent.execute(
      {
        name: "test-agent",
        includeMemory: false,
      },
      toolCtx
    );

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
    const result = await tools.hera_package_agent.execute(
      {
        name: "test-agent",
        includeMemory: false,
        outputName: "custom-name",
      },
      toolCtx
    );

    expect(result).toContain("packaged successfully");

    // Verify custom package name
    const packageDir = join(testDir, "hera-data", "packages");
    const packagePath = join(packageDir, "custom-name.tar.gz");
    const packageStat = await stat(packagePath);
    expect(packageStat.isFile()).toBe(true);
  });

  test("hera_unpack_agent fails for non-existent package", async () => {
    const tools = createPackageTools(ctx);
    const result = await tools.hera_unpack_agent.execute(
      {
        packagePath: "/non/existent/package.tar.gz",
      },
      toolCtx
    );

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
    await tools.hera_package_agent.execute(
      {
        name: "test-agent",
        includeMemory: false,
      },
      toolCtx
    );

    // List packages
    const result = await tools.hera_list_packages.execute({}, toolCtx);

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
    const packageResult = await tools.hera_package_agent.execute(
      {
        name: "test-agent",
        includeMemory: false,
      },
      toolCtx
    );
    expect(packageResult).toContain("packaged successfully");

    // Delete the original .md file
    await rm(mdPath);

    // Unpack the agent
    const packagePath = join(testDir, "hera-data", "packages", "test-agent-package.tar.gz");
    const unpackResult = await tools.hera_unpack_agent.execute(
      {
        packagePath,
        installPlugin: false,
      },
      toolCtx
    );
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
    const result = await tools.hera_package_agent.execute(
      {
        name: "test-agent",
        includeMemory: true,
      },
      toolCtx
    );

    expect(result).toContain("packaged successfully");
    expect(result).toContain("Memory included: true");
  });

  describe("manifest validation", () => {
    test("accepts a well-formed manifest", () => {
      const result = validateManifest({
        version: "1.0",
        agentName: "good-agent",
        packagedAt: 1,
        mode: "md",
        includesMemory: false,
        files: [],
      });
      expect(result.valid).toBe(true);
    });

    test("rejects an unsupported version", () => {
      const result = validateManifest({ version: "2.0", agentName: "x", mode: "md" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("Unsupported package version");
    });

    test("rejects a non-object manifest", () => {
      expect(validateManifest(null).valid).toBe(false);
      expect(validateManifest("nope").valid).toBe(false);
    });

    test("rejects a traversal agent name", () => {
      const result = validateManifest({
        version: "1.0",
        agentName: "../../etc/evil",
        mode: "md",
      });
      expect(result.valid).toBe(false);
    });

    test("rejects an unknown mode", () => {
      const result = validateManifest({ version: "1.0", agentName: "ok", mode: "exe" });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain("Invalid package mode");
    });
  });

  describe("archive entry safety", () => {
    test("allows normal entries", () => {
      expect(isEntryInsideDir("/tmp/extract", "manifest.json")).toBe(true);
      expect(isEntryInsideDir("/tmp/extract", "memory/agents/x.json")).toBe(true);
    });

    test("blocks parent-escaping and absolute entries", () => {
      expect(isEntryInsideDir("/tmp/extract", "../escaped.txt")).toBe(false);
      expect(isEntryInsideDir("/tmp/extract", "../../etc/passwd")).toBe(false);
    });
  });

  test("hera_unpack_agent rejects a package with an unsupported manifest version", async () => {
    const staging = join(testDir, "bad-version-staging");
    await mkdir(staging, { recursive: true });
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({ version: "9.9", agentName: "x", mode: "md", includesMemory: false, files: [] })
    );
    const pkgPath = join(testDir, "bad-version.tar.gz");
    await makeTarGz(staging, pkgPath);

    const tools = createPackageTools(ctx);
    const result = await tools.hera_unpack_agent.execute(
      { packagePath: pkgPath, installPlugin: false },
      toolCtx
    );
    expect(result).toContain("Unsupported package version");
  });

  test("hera_unpack_agent rejects a package with a malformed manifest", async () => {
    const staging = join(testDir, "bad-manifest-staging");
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, "manifest.json"), "{not valid json");
    const pkgPath = join(testDir, "bad-manifest.tar.gz");
    await makeTarGz(staging, pkgPath);

    const tools = createPackageTools(ctx);
    const result = await tools.hera_unpack_agent.execute(
      { packagePath: pkgPath, installPlugin: false },
      toolCtx
    );
    expect(result).toContain("manifest");
  });

  test("hera_unpack_agent refuses a path-traversal archive entry", async () => {
    const staging = join(testDir, "evil-staging");
    await mkdir(staging, { recursive: true });
    await writeFile(
      join(staging, "manifest.json"),
      JSON.stringify({
        version: "1.0",
        agentName: "evil-agent",
        mode: "md",
        includesMemory: false,
        files: [],
      })
    );
    await writeFile(join(staging, "evil.md"), "PWNED");

    const pkgPath = join(testDir, "evil.tar.gz");
    // Remap the payload file so its archive entry escapes the extraction root.
    await makeTarGz(staging, pkgPath, (name) =>
      name === "evil.md" ? "../escaped-evil.md" : name
    );

    const tools = createPackageTools(ctx);
    const result = await tools.hera_unpack_agent.execute(
      { packagePath: pkgPath, installPlugin: false },
      toolCtx
    );
    expect(result).toContain("Error");

    // The escaping file must never have been written outside the extraction root.
    const escapedPath = join(testDir, "hera-data", "escaped-evil.md");
    await expect(access(escapedPath)).rejects.toThrow();
  });
});
