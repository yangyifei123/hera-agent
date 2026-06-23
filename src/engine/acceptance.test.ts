// src/engine/acceptance.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcceptanceEvaluator } from "./acceptance.js";

describe("AcceptanceEvaluator", () => {
  let dir: string;
  let evalr: AcceptanceEvaluator;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "accept-"));
    evalr = new AcceptanceEvaluator({ shellEnabled: true, defaultTimeoutMs: 5000 });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes file_exists when the file is present", async () => {
    const p = join(dir, "made.txt");
    await writeFile(p, "hi");
    const r = await evalr.evaluate([{ type: "file_exists", path: p }], { output: "", cwd: dir }, 1);
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails file_exists when missing", async () => {
    const r = await evalr.evaluate(
      [{ type: "file_exists", path: join(dir, "nope.txt") }],
      { output: "", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(false);
  });

  it("passes a shell check on exit 0", async () => {
    const r = await evalr.evaluate(
      [{ type: "shell", command: "exit 0" }],
      { output: "", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails a shell check on nonzero exit", async () => {
    const r = await evalr.evaluate(
      [{ type: "shell", command: "exit 3" }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("3");
  });

  it("fails a shell check on timeout", async () => {
    // Windows: `sleep` is not a cmd.exe builtin; use ping to block reliably.
    const slow =
      process.platform === "win32" ? "ping -n 6 127.0.0.1 >NUL" : "sleep 5";
    const r = await evalr.evaluate(
      [{ type: "shell", command: slow, timeoutMs: 50 }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail?.toLowerCase()).toContain("timeout");
  });

  it("matches regex against output", async () => {
    const r = await evalr.evaluate(
      [{ type: "regex", source: "output", pattern: "DONE" }],
      { output: "build DONE", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails shell checks when shell is disabled", async () => {
    const disabled = new AcceptanceEvaluator({ shellEnabled: false });
    const r = await disabled.evaluate([{ type: "shell", command: "exit 0" }], { output: "", cwd: dir }, 1);
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("disabled");
  });
});
