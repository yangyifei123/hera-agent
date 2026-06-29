/**
 * E2E test: generates a plugin via PluginGenerator and runs the actual
 * `bun build` command against it to confirm the generated TypeScript is
 * syntactically valid and can produce a working dist bundle.
 *
 * Why no `bun install` step: the plugin's build script externalises
 * @opencode-ai/plugin and @opencode-ai/sdk, so bun build does NOT need
 * those packages installed to bundle — it just emits import statements
 * referring to them. This lets the test run offline.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginGenerator } from "./plugin-generator.js";
import { TeamPluginGenerator } from "./team-plugin-generator.js";
import type { AgentDefinition, TeamDefinition } from "../types.js";

const E2E_TIMEOUT_MS = 60_000;

function runBunBuild(cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const BunGlobal = (globalThis as any).Bun;
    if (!BunGlobal?.spawn) {
      resolve({ ok: false, stdout: "", stderr: "Bun.spawn not available" });
      return;
    }
    const proc = BunGlobal.spawn(["bun", "run", "build"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).then(([stdout, stderr, exitCode]) => {
      resolve({ ok: exitCode === 0, stdout, stderr });
    });
  });
}

describe("E2E: generated plugin builds with bun build", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-e2e-build-"));
  });

  afterEach(async () => {
    try {
      await rm(tmp, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it(
    "agent plugin: generated src/index.ts builds to a dist bundle",
    async () => {
      const gen = new PluginGenerator();
      const agent: AgentDefinition = {
        name: "e2e-test-agent",
        description: "End-to-end test agent",
        mode: "subagent",
        prompt: "You are an e2e test agent.",
        skills: ["caveman", "init", "memory", "evolution"],
        maxSteps: 30,
        createdAt: Date.now(),
        evolutionLog: [
          {
            timestamp: Date.now(),
            trigger: "test",
            observation: "test",
            directive: "Test directive",
            rolledBack: false,
          },
        ],
      };
      const pkg = gen.generate(agent, [], { withEngine: false });
      const pluginDir = join(tmp, "e2e-test-agent");
      await gen.writeToDisk(pkg, pluginDir);

      const result = await runBunBuild(pluginDir);
      if (!result.ok) {
        // Surface stderr in test output so failures are diagnosable.
        throw new Error(`bun build failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }

      // Verify the dist bundle actually exists and is non-empty.
      const distPath = join(pluginDir, "dist", "index.js");
      const s = await stat(distPath);
      expect(s.isFile()).toBe(true);
      expect(s.size).toBeGreaterThan(0);

      // Verify the bundle preserves the agent's identity and prompt skeleton.
      const distContent = await readFile(distPath, "utf-8");
      expect(distContent).toContain("e2e-test-agent");
      expect(distContent).toContain("hera_remember");
    },
    E2E_TIMEOUT_MS
  );

  it(
    "team plugin: generated src/index.ts builds to a dist bundle",
    async () => {
      const gen = new TeamPluginGenerator();
      const team: TeamDefinition = {
        name: "e2e-test-team",
        description: "End-to-end test team",
        coordination: "parallel",
        members: [
          { agentName: "alpha", role: "lead", subscriptions: [], backendType: "in-process" },
          { agentName: "beta", role: "worker", subscriptions: [], backendType: "in-process" },
        ],
      };
      const members: AgentDefinition[] = team.members.map((m) => ({
        name: m.agentName,
        description: `${m.agentName} member`,
        mode: "subagent",
        prompt: `You are ${m.agentName}.`,
        skills: ["caveman", "memory"],
        maxSteps: 30,
        createdAt: Date.now(),
        evolutionLog: [],
      }));
      const pkg = gen.generate(team, members, [], { withEngine: false });
      const pluginDir = join(tmp, "e2e-test-team-plugin");
      await gen.writeToDisk(pkg, pluginDir);

      const result = await runBunBuild(pluginDir);
      if (!result.ok) {
        throw new Error(`bun build failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      }

      const distPath = join(pluginDir, "dist", "index.js");
      const s = await stat(distPath);
      expect(s.isFile()).toBe(true);
      expect(s.size).toBeGreaterThan(0);

      const distContent = await readFile(distPath, "utf-8");
      // Both member agents must appear in the compiled output.
      expect(distContent).toContain("alpha");
      expect(distContent).toContain("beta");
    },
    E2E_TIMEOUT_MS
  );
});
