// src/engine/acceptance.ts
import { exec } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { AcceptanceCheck, AcceptanceResult } from "./task-types.js";

export interface AcceptanceContext {
  output: string;
  cwd: string;
}

export interface AcceptanceEvaluatorOptions {
  shellEnabled?: boolean;
  defaultTimeoutMs?: number;
}

export class AcceptanceEvaluator {
  private shellEnabled: boolean;
  private defaultTimeoutMs: number;

  constructor(options: AcceptanceEvaluatorOptions = {}) {
    this.shellEnabled = options.shellEnabled ?? true;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300000;
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
    try {
      switch (check.type) {
        case "file_exists":
          return this.result(check, await this.fileExists(check.path, ctx.cwd), now);
        case "regex":
          return this.regex(check, ctx, now);
        case "shell":
          return this.shell(check, ctx, now);
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
    const matched = new RegExp(check.pattern).test(source);
    return this.result(check, matched, now, matched ? "matched" : "no match");
  }

  private async shell(
    check: Extract<AcceptanceCheck, { type: "shell" }>,
    ctx: AcceptanceContext,
    now: number
  ): Promise<AcceptanceResult> {
    if (!this.shellEnabled) return this.result(check, false, now, "shell checks disabled");
    const expectExit = check.expectExit ?? 0;
    const timeout = check.timeoutMs ?? this.defaultTimeoutMs;
    const code = await new Promise<number | "timeout">((resolve) => {
      const child = exec(check.command, { cwd: check.cwd ?? ctx.cwd, timeout }, (err) => {
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolve("timeout");
        } else if (err && typeof (err as { code?: number }).code === "number") {
          resolve((err as { code: number }).code);
        } else {
          resolve(0);
        }
      });
      child.on("error", () => resolve(-1));
    });
    if (code === "timeout") return this.result(check, false, now, "timeout");
    return this.result(check, code === expectExit, now, `exit ${code}`);
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
