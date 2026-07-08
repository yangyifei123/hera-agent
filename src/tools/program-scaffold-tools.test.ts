// src/tools/program-scaffold-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import { SkillManager } from "../skills/manager.js";
import { MemoryStore } from "../memory/store.js";
import { createProgramScaffoldTools } from "./program-scaffold-tools.js";
import type { PluginContext } from "../types.js";

const TOOL_CTX: ToolContext = {
  sessionID: "s1",
  directory: "/work",
  worktree: "/work",
  messageID: "m1",
  agent: "hera",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: (() => {
    throw new Error("ask not used in test");
  }) as ToolContext["ask"],
};

describe("hera_create_program_skill", () => {
  let root: string;
  let skillManager: SkillManager;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "scaffold-"));
    const store = new MemoryStore(join(root, "memory"));
    await store.init();
    skillManager = new SkillManager(store, join(root, "skills"));
    await skillManager.init();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("scaffolds a program skill dir with SKILL.json, run.ts, and hera-sdk.d.ts", async () => {
    const ctx = { skillManager } as unknown as PluginContext;
    const tools = createProgramScaffoldTools(ctx);
    const out = await tools.hera_create_program_skill.execute(
      { name: "release-notes", description: "Draft release notes" },
      TOOL_CTX
    );
    expect(out).toContain("release-notes");

    const dir = join(root, "skills", "release-notes");
    expect(JSON.parse(await readFile(join(dir, "SKILL.json"), "utf-8")).program).toBe("run.ts");
    expect(await readFile(join(dir, "run.ts"), "utf-8")).toContain(
      "export default async function run"
    );
    expect(await readFile(join(dir, "hera-sdk.d.ts"), "utf-8")).toContain("export interface Hera");

    // Loaded in-memory as a program skill.
    expect(skillManager.getSkillPackage("release-notes")?.program).toBe("run.ts");
  });

  it("rejects a built-in name", async () => {
    const ctx = { skillManager } as unknown as PluginContext;
    const tools = createProgramScaffoldTools(ctx);
    const out = await tools.hera_create_program_skill.execute(
      { name: "memory", description: "x" },
      TOOL_CTX
    );
    expect((out as string).toLowerCase()).toContain("built-in");
  });
});
