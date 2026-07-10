// src/commands/command-file.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateCommandName,
  buildCommandMarkdown,
  writeCommandFile,
  ARGUMENTS_PLACEHOLDER,
} from "./command-file.js";

describe("validateCommandName", () => {
  it("accepts a kebab-case name", () => {
    expect(validateCommandName("socrates").valid).toBe(true);
    expect(validateCommandName("ulw-loop").valid).toBe(true);
  });

  it("rejects empty, path traversal, uppercase, leading digit, and trailing hyphen", () => {
    expect(validateCommandName("").valid).toBe(false);
    expect(validateCommandName("../escape").valid).toBe(false);
    expect(validateCommandName("Socrates").valid).toBe(false);
    expect(validateCommandName("1plato").valid).toBe(false);
    expect(validateCommandName("plato-").valid).toBe(false);
    expect(validateCommandName("a".repeat(51)).valid).toBe(false);
  });
});

describe("buildCommandMarkdown", () => {
  it("routes to the agent with a default $ARGUMENTS body", () => {
    const md = buildCommandMarkdown({
      name: "socrates",
      agent: "socrates",
      description: "Consult Socrates",
    });
    expect(md).toContain("agent: socrates");
    expect(md).toContain("description: Consult Socrates");
    expect(md).toContain(ARGUMENTS_PLACEHOLDER);
    expect(md.startsWith("---\n")).toBe(true);
  });

  it("uses a custom body when provided", () => {
    const md = buildCommandMarkdown({
      name: "mode",
      agent: "hera",
      description: "Switch mode",
      body: "Already handled. Do not call any tool.",
    });
    expect(md).toContain("Already handled. Do not call any tool.");
    expect(md).not.toContain(ARGUMENTS_PLACEHOLDER);
  });
});

describe("writeCommandFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cmdfile-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes <configRoot>/command/<name>.md and returns the path", async () => {
    const md = buildCommandMarkdown({ name: "plato", agent: "plato", description: "Ask Plato" });
    const path = await writeCommandFile(dir, "plato", md);
    expect(path).toBe(join(dir, "command", "plato.md"));
    expect(await readFile(path, "utf-8")).toBe(md);
  });

  it("is idempotent (second write keeps identical content)", async () => {
    const md = buildCommandMarkdown({ name: "plato", agent: "plato", description: "Ask Plato" });
    await writeCommandFile(dir, "plato", md);
    await writeCommandFile(dir, "plato", md);
    expect(await readFile(join(dir, "command", "plato.md"), "utf-8")).toBe(md);
  });

  it("rejects an unsafe name before any write", async () => {
    await expect(writeCommandFile(dir, "../escape", "x")).rejects.toThrow(/Command name/);
  });

  it("propagates a write failure (throws) so callers can decide best-effort", async () => {
    // Make <dir>/command a FILE so mkdir(<dir>/command) fails.
    await writeFile(join(dir, "command"), "x", "utf-8");
    await expect(writeCommandFile(dir, "plato", "y")).rejects.toBeDefined();
  });
});
