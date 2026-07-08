// src/program/runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramRunner } from "./runner.js";
import type { AgentRunner } from "../engine/executor.js";
import type { SkillPackage } from "../types.js";

// Run the real harness from source (bun test runs from src/).
const HARNESS = join(import.meta.dir, "child-harness.ts");
const NOOP_RUNNER: AgentRunner = { run: async () => "" };

function skillManagerWith(program: string | undefined) {
  const pkg: SkillPackage | undefined = program
    ? { name: "fix", description: "", trigger: "", prompt: "", program, config: {}, files: [] }
    : undefined;
  return { getSkillPackage: () => pkg };
}

async function writeSkill(skillsDir: string, name: string, body: string) {
  await mkdir(join(skillsDir, name), { recursive: true });
  await writeFile(join(skillsDir, name, "run.ts"), body, "utf-8");
}

describe("ProgramRunner", () => {
  let root: string;
  let skillsDir: string;
  let workDir: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "prog-"));
    skillsDir = join(root, "skills");
    workDir = join(root, "work");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("runs a deterministic program to ok:true with side effects and logs", async () => {
    await writeSkill(
      skillsDir,
      "fix",
      `export default async function run(hera) {
         await hera.sh("echo hi");
         await hera.file.write("out.txt", "hello");
         hera.log("did work");
         return { done: true };
       }`
    );
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", { x: 1 }, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ done: true });
    expect(res.logs).toContain("did work");
    expect(await readFile(join(workDir, "out.txt"), "utf-8")).toBe("hello");
  });

  it("returns ok:false with the thrown message", async () => {
    await writeSkill(
      skillsDir,
      "fix",
      `export default async function run() { throw new Error("boom"); }`
    );
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("boom");
  });

  it("kills a hanging program on timeout and returns ok:false", async () => {
    await writeSkill(
      skillsDir,
      "fix",
      `export default async function run() { await new Promise(() => {}); }`
    );
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
      timeoutMs: 400,
    });
    const start = Date.now();
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("timed out");
    expect(Date.now() - start).toBeLessThan(8000);
  });

  it("serves an llm step with a schema and returns the validated object", async () => {
    await writeSkill(
      skillsDir,
      "fix",
      `export default async function run(hera) {
         const notes = await hera.llm("Write release notes", {
           schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
         });
         await hera.file.write("notes.json", JSON.stringify(notes));
         return notes;
       }`
    );
    const mockRunner: AgentRunner = { run: async () => 'Sure: {"title":"Release 1.0"} done' };
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir,
      runner: mockRunner,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ title: "Release 1.0" });
    expect(await readFile(join(workDir, "notes.json"), "utf-8")).toBe('{"title":"Release 1.0"}');
  });

  it("returns ok:false without spawning when the skill has no program", async () => {
    const runner = new ProgramRunner({
      skillManager: skillManagerWith(undefined),
      skillsDir,
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not a program skill");
  });

  it("returns ok:false when the program entry file is missing", async () => {
    const runner = new ProgramRunner({
      skillManager: skillManagerWith("run.ts"),
      skillsDir, // no fix/run.ts written
      runner: NOOP_RUNNER,
      harnessPath: HARNESS,
    });
    const res = await runner.run("fix", null, { sessionID: "s1", directory: workDir });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not found");
  });
});
