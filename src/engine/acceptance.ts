// src/engine/acceptance.ts
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { heraLog } from "../logger.js";
import { JUDGE_TIMEOUT_MS, TASK_LEASE_MS } from "../constants.js";
import { RubricJudge, type JudgeRunner } from "./judge.js";
import { runShell } from "./shell-exec.js";
import type { AcceptanceCheck, AcceptanceResult } from "./task-types.js";

export type { JudgeRunner } from "./judge.js";

export interface AcceptanceContext {
  output: string;
  cwd: string;
}

/**
 * Reject regex patterns longer than this. Catastrophic backtracking (ReDoS)
 * needs a sufficiently nested/ambiguous pattern; a hard length cap removes the
 * worst offenders before they ever compile.
 */
const MAX_REGEX_PATTERN_LENGTH = 1000;
/**
 * Only test the regex against the first N chars of source. Backtracking blowup
 * scales with input length, so bounding the haystack bounds worst-case work
 * (a synchronous regex cannot be interrupted mid-`exec`).
 */
const MAX_REGEX_SOURCE_LENGTH = 256_000;

/**
 * Static heuristic for catastrophic-backtracking shapes (e.g. `(a+)+`, `(.*)*`,
 * `([a-z]+)*`): a quantifier immediately inside a group that is itself quantified
 * with an unbounded repeat. Synchronous JS regex cannot be interrupted once it
 * starts, so we refuse to run these rather than risk wedging the loop tick.
 */
function looksCatastrophic(pattern: string): boolean {
  // Drop escaped chars so `\+\)` and the like don't trip the detector.
  const stripped = pattern.replace(/\\./g, "");
  return /[+*?}]\)[+*{]/.test(stripped);
}

/**
 * Run a single regex test with bounds against catastrophic backtracking (ReDoS).
 * Over-long, statically dangerous, or invalid patterns fail the check (return
 * false) rather than risk wedging the supervisor/loop tick, and the source is
 * truncated so the matcher's work is bounded.
 */
export function boundedRegexTest(pattern: string, source: string): boolean {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  if (looksCatastrophic(pattern)) return false;
  const haystack =
    source.length > MAX_REGEX_SOURCE_LENGTH ? source.slice(0, MAX_REGEX_SOURCE_LENGTH) : source;
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return false;
  }
  try {
    return re.test(haystack);
  } catch {
    return false;
  }
}

export interface AcceptanceEvaluatorOptions {
  shellEnabled?: boolean;
  defaultTimeoutMs?: number;
  judge?: JudgeRunner;
  judgeTimeoutMs?: number;
  judgeAgentName?: string;
  judgeDefaultSamples?: number;
  judgeEvidenceFileCap?: number;
  judgeEvidenceTotalCap?: number;
}

export class AcceptanceEvaluator {
  private shellEnabled: boolean;
  private defaultTimeoutMs: number;
  private rubricJudge: RubricJudge | undefined;

  constructor(options: AcceptanceEvaluatorOptions = {}) {
    this.shellEnabled = options.shellEnabled ?? true;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300000;
    this.rubricJudge = options.judge
      ? new RubricJudge(options.judge, {
          timeoutMs: options.judgeTimeoutMs ?? JUDGE_TIMEOUT_MS,
          defaultSamples: options.judgeDefaultSamples,
          evidenceFileCap: options.judgeEvidenceFileCap,
          evidenceTotalCap: options.judgeEvidenceTotalCap,
          judgeAgentName: options.judgeAgentName ?? "unknown",
        })
      : undefined;
  }

  async evaluate(
    checks: AcceptanceCheck[],
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult[]> {
    const results: AcceptanceResult[] = [];
    for (const check of checks) {
      results.push(await this.one(check, ctx, now));
    }
    return results;
  }

  allPassed(results: AcceptanceResult[]): boolean {
    return results.length > 0 && results.every((r) => r.passed);
  }

  private async one(
    check: AcceptanceCheck,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    // Every async branch below MUST be `return await`, not a bare `return`:
    // a bare `return promise` settles outside this try/catch, so an async
    // rejection (e.g. RubricJudge throwing on a corrupted-ledger rubric)
    // would escape evaluate() and skip the fail-closed containment.
    try {
      switch (check.type) {
        case "file_exists": {
          const exists = await this.fileExists(check.path, ctx.cwd);
          return this.result(
            check,
            exists,
            now,
            exists ? "exists" : `file not found: ${check.path}`
          );
        }
        case "regex":
          return await this.regex(check, ctx, now);
        case "shell":
          return await this.shell(check, ctx, now);
        case "llm_judge":
          return await this.llmJudge(check, ctx, now);
        default:
          return this.result(check as AcceptanceCheck, false, now, "unknown check type");
      }
    } catch (err) {
      return this.result(check, false, now, err instanceof Error ? err.message : String(err));
    }
  }

  private resolvePath(p: string, cwd: string): string {
    return isAbsolute(p) ? p : join(cwd, p);
  }

  private async fileExists(path: string, cwd: string): Promise<boolean> {
    try {
      await access(this.resolvePath(path, cwd));
      return true;
    } catch {
      return false;
    }
  }

  private async regex(
    check: Extract<AcceptanceCheck, { type: "regex" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    let source = ctx.output;
    if (check.source === "file") {
      if (!this.shellEnabled) return this.result(check, false, now, "file checks disabled");
      if (!check.path) return this.result(check, false, now, "regex file source requires path");
      source = await readFile(this.resolvePath(check.path, ctx.cwd), "utf-8");
    }
    const matched = boundedRegexTest(check.pattern, source);
    return this.result(check, matched, now, matched ? "matched" : "no match");
  }

  private async shell(
    check: Extract<AcceptanceCheck, { type: "shell" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    if (!this.shellEnabled) return this.result(check, false, now, "shell checks disabled");
    const expectExit = check.expectExit ?? 0;
    const timeout = this.resolveShellTimeoutMs(check.timeoutMs);
    const res = await runShell(check.command, { cwd: check.cwd ?? ctx.cwd, timeoutMs: timeout });
    if (res.timedOut) return this.result(check, false, now, "timeout");
    return this.result(check, res.code === expectExit, now, `exit ${res.code}`);
  }

  /**
   * Resolve a shell acceptance check's timeout to a value that is always
   * strictly positive. `runShell` intentionally treats `timeoutMs <= 0` as
   * "no timer" (required so hera.sh program steps can omit it and rely solely
   * on the outer ProgramRunner's total-timeout kill), but an acceptance check
   * must never hand it a non-positive value: that would let a wedged shell
   * check hang the whole evaluation forever. `check.timeoutMs` is optional and
   * schema-unconstrained (an explicit 0 is valid input), and `?? this.defaultTimeoutMs`
   * does not catch that explicit 0, so both sides of the fallback chain are
   * clamped here.
   */
  private resolveShellTimeoutMs(checkTimeoutMs: number | undefined): number {
    if (typeof checkTimeoutMs === "number" && checkTimeoutMs > 0) return checkTimeoutMs;
    if (this.defaultTimeoutMs > 0) return this.defaultTimeoutMs;
    heraLog(
      "warn",
      `Acceptance shell check has a non-positive timeout (check.timeoutMs=${checkTimeoutMs}, ` +
        `defaultTimeoutMs=${this.defaultTimeoutMs}); falling back to ${TASK_LEASE_MS}ms so the ` +
        "check cannot hang the evaluation."
    );
    return TASK_LEASE_MS;
  }

  private async llmJudge(
    check: Extract<AcceptanceCheck, { type: "llm_judge" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    if (!this.rubricJudge) return this.result(check, false, now, "no judge configured");
    const { passed, detail, verdict } = await this.rubricJudge.judge(check, {
      output: ctx.output,
      cwd: ctx.cwd,
    });
    const res = this.result(check, passed, now, detail);
    if (verdict) res.verdict = verdict;
    return res;
  }

  private result(
    check: AcceptanceCheck,
    passed: boolean,
    at: number,
    detail?: string
  ): AcceptanceResult {
    return { check, passed, detail, at };
  }
}
