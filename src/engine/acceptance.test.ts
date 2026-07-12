// src/engine/acceptance.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcceptanceEvaluator } from "./acceptance.js";
import type { AcceptanceCheck } from "./task-types.js";

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
      judge: async () => '{"criteria":[{"id":"c1","reasoning":"solid work","score":0.9}]}',
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
      judge: async () => 'Here: {"criteria":[{"id":"c1","reasoning":"shallow","score":0.4}]} ok',
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

  it("llm_judge: analytic rubric produces a structured verdict on the result", async () => {
    const evalr2 = new AcceptanceEvaluator({
      judge: async () => '{"criteria":[{"id":"c1","reasoning":"solid","score":0.9}]}',
      judgeAgentName: "hera-judge",
    });
    const r = await evalr2.evaluate(
      [{ type: "llm_judge", rubric: "is it good" }],
      { output: "work", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(true);
    expect(r[0].verdict?.criteria[0].score).toBe(0.9);
    expect(r[0].verdict?.judgeAgent).toBe("hera-judge");
    expect(r[0].detail).toContain("0.90");
  });

  it("llm_judge: multi-criterion critical veto fails the check", async () => {
    const evalr2 = new AcceptanceEvaluator({
      judge: async () =>
        '{"criteria":[{"id":"c1","reasoning":"r","score":1},{"id":"docs","reasoning":"r","score":0.5}]}',
    });
    const r = await evalr2.evaluate(
      [
        {
          type: "llm_judge",
          rubric: [
            { requirement: "works" },
            { id: "docs", requirement: "documented", critical: true },
          ],
        },
      ],
      { output: "work", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].verdict?.pass).toBe(false);
  });

  it("llm_judge: junk rubric type fails closed instead of rejecting (corrupted ledger)", async () => {
    // A hand-edited/corrupted ledger entry (loaded without re-validation) can
    // carry a rubric that is neither string nor array. RubricJudge throws a
    // TypeError from normalizeCriteria in that case; the evaluator must
    // contain it as a failed check, never reject out of evaluate() — a
    // rejection escapes runAttempt AFTER the token-costing agent run and burns
    // every retry until maxAttempts (fail-closed Global Constraint).
    const evalr2 = new AcceptanceEvaluator({
      judge: async () => '{"criteria":[{"id":"c1","reasoning":"r","score":1}]}',
    });
    const junk = { type: "llm_judge", rubric: 42 } as unknown as AcceptanceCheck;
    const r = await evalr2.evaluate([junk], { output: "w", cwd: dir }, 1);
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toBeTruthy();
  });

  it("llm_judge: non-array evidence.files fails closed instead of rejecting", async () => {
    const evalr2 = new AcceptanceEvaluator({
      judge: async () => '{"criteria":[{"id":"c1","reasoning":"r","score":1}]}',
    });
    const junk = {
      type: "llm_judge",
      rubric: "x",
      evidence: { files: 7 },
    } as unknown as AcceptanceCheck;
    const r = await evalr2.evaluate([junk], { output: "w", cwd: dir }, 1);
    expect(r[0].passed).toBe(false);
    expect(r[0].detail).toBeTruthy();
  });

  it("verdict survives JSON persistence round-trip", async () => {
    const evalr2 = new AcceptanceEvaluator({
      judge: async () => '{"criteria":[{"id":"c1","reasoning":"r","score":0.8}]}',
    });
    const r = await evalr2.evaluate(
      [{ type: "llm_judge", rubric: "good" }],
      { output: "w", cwd: dir },
      1
    );
    expect(JSON.parse(JSON.stringify(r[0]))).toEqual(r[0]);
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

  it("enforces a positive timeout even when the check explicitly requests timeoutMs: 0", async () => {
    // check.timeoutMs: 0 is allowed by the schema (no positivity constraint) and
    // `?? defaultTimeoutMs` does NOT catch an explicit 0. runShell treats
    // timeoutMs <= 0 as "no timer" (required for hera.sh's no-cap mode), so the
    // evaluator itself must clamp to a strictly positive timeout before calling
    // it — otherwise a wedged shell check hangs the whole evaluation forever.
    // Use a tiny defaultTimeoutMs so the assertion stays fast and deterministic.
    const tiny = new AcceptanceEvaluator({ shellEnabled: true, defaultTimeoutMs: 50 });
    const slow = process.platform === "win32" ? "ping -n 6 127.0.0.1 >NUL" : "sleep 5";
    const start = Date.now();
    const r = await tiny.evaluate(
      [{ type: "shell", command: slow, timeoutMs: 0 }],
      { output: "", cwd: dir },
      1
    );
    expect(r[0].passed).toBe(false);
    expect(r[0].detail?.toLowerCase()).toContain("timeout");
    // Resolves promptly (bounded by the clamped-to-default timeout + tree-kill
    // wait), not after the full 5s blocking command.
    expect(Date.now() - start).toBeLessThan(4000);
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
