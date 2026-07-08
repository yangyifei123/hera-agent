import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModeCommandFile, MODE_COMMAND_MARKDOWN } from "./install.js";

describe("writeModeCommandFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mode-install-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes command/mode.md under the config root", async () => {
    await writeModeCommandFile(dir);
    const content = await readFile(join(dir, "command", "mode.md"), "utf-8");
    expect(content).toBe(MODE_COMMAND_MARKDOWN);
    expect(content).toContain("agent: hera");
    expect(content).toContain("/mode program <skill>");
  });

  it("is idempotent (second write keeps identical content)", async () => {
    await writeModeCommandFile(dir);
    await writeModeCommandFile(dir);
    const content = await readFile(join(dir, "command", "mode.md"), "utf-8");
    expect(content).toBe(MODE_COMMAND_MARKDOWN);
  });

  it("swallows write failures (best effort) and does not throw", async () => {
    // Make <dir>/command a FILE so mkdir(<dir>/command) throws; the writer must
    // catch, log at warn, and return without throwing, leaving the file intact.
    await writeFile(join(dir, "command"), "x", "utf-8");
    await writeModeCommandFile(dir);
    const content = await readFile(join(dir, "command"), "utf-8");
    expect(content).toBe("x");
  });
});
