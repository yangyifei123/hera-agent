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
    // maxRetries tolerates transient Windows EBUSY/EPERM while a just-killed
    // child process releases its handle on the temp dir.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("passes file_exists when the file is present", async () => {
    const p = join(dir, "made.txt");
    await writeFile(p, "hi");
    const r = await evalr.evaluate([{ type: "file_exists", path: p }], { output: "", cwd: dir }, 1);
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails file_exists when missing, with an explanatory detail", async () => {
    const r = await evalr.evaluate(
      [{ type: "file_exists", path: join(dir, "nope.txt") }],
      { output: "", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(false);
    expect(r[0].detail).toContain("file not found");
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
    const slow = process.platform === "win32" ? "ping -n 6 127.0.0.1 >NUL" : "sleep 5";
    const r = await evalr.evaluate(
      [{ type: "shell", command: slow, timeoutMs: 50 }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail?.toLowerCase()).toContain("timeout");
  });

  it("llm_judge passes when the judge returns pass + score >= threshold", async () => {
    const judge = new AcceptanceEvaluator({
      judge: async () => '{"pass": true, "score": 0.9, "reasoning": "solid work"}',
    });
    const r = await judge.evaluate(
      [{ type: "llm_judge", rubric: "the function must be implemented" }],
      { output: "done", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(true);
    expect(r[0].detail).toContain("0.90");
  });

  it("llm_judge fails when score is below threshold", async () => {
    const judge = new AcceptanceEvaluator({
      judge: async () => 'Here: {"pass": true, "score": 0.4, "reasoning": "shallow"} ok',
    });
    const r = await judge.evaluate(
      [{ type: "llm_judge", rubric: "x", threshold: 0.7 }],
      { output: "meh", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
  });

  it("llm_judge fails closed when no judge is configured", async () => {
    const r = await evalr.evaluate(
      [{ type: "llm_judge", rubric: "x" }],
      { output: "anything", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("no judge");
  });

  it("llm_judge fails closed on unparseable judge output", async () => {
    const judge = new AcceptanceEvaluator({ judge: async () => "I think it is fine, yes." });
    const r = await judge.evaluate(
      [{ type: "llm_judge", rubric: "x" }],
      { output: "y", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("unparseable");
  });

  it("matches regex against output", async () => {
    const r = await evalr.evaluate(
      [{ type: "regex", source: "output", pattern: "DONE" }],
      { output: "build DONE", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails an over-long regex pattern instead of hanging", async () => {
    const tooLong = "a".repeat(2000);
    const start = Date.now();
    const r = await evalr.evaluate(
      [{ type: "regex", source: "output", pattern: tooLong }],
      { output: "a".repeat(2000), cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("does not hang on a catastrophic-backtracking pattern against large input", async () => {
    const pattern = "(a+)+$";
    const output = "a".repeat(60000) + "!";
    const start = Date.now();
    const r = await evalr.evaluate(
      [{ type: "regex", source: "output", pattern }],
      { output, cwd: dir },
      1
    );
    expect(typeof r[0].passed).toBe("boolean");
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("still matches a normal regex against bounded output", async () => {
    const r = await evalr.evaluate(
      [{ type: "regex", source: "output", pattern: "BUILD (OK|DONE)" }],
      { output: "result: BUILD OK", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });

  it("fails shell checks when shell is disabled", async () => {
    const disabled = new AcceptanceEvaluator({ shellEnabled: false });
    const r = await disabled.evaluate(
      [{ type: "shell", command: "exit 0" }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toContain("disabled");
  });

  it("passes file_exists with a relative path resolved against ctx.cwd", async () => {
    await writeFile(join(dir, "rel.txt"), "hello");
    const r = await evalr.evaluate(
      [{ type: "file_exists", path: "rel.txt" }],
      { output: "", cwd: dir },
      1
    );
    expect(evalr.allPassed(r)).toBe(true);
  });
});
