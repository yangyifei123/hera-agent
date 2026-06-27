// src/engine/acceptance.ts
import { exec, execFile } from "node:child_process";
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
      let settled = false;
      let timedOut = false;
      const handle: { timer?: ReturnType<typeof setTimeout> } = {};
      const finish = (v: number | "timeout") => {
        if (settled) return;
        settled = true;
        if (handle.timer) clearTimeout(handle.timer);
        resolve(v);
      };
      // Manual timeout + process-tree kill. Node's built-in exec `timeout` only
      // signals the top-level shell; on Windows `cmd.exe /c` does not propagate
      // the kill to its children, leaking the child process (e.g. a blocking
      // `ping`) which keeps holding `cwd` and breaks downstream cleanup.
      const child = exec(
        check.command,
        {
          cwd: check.cwd ?? ctx.cwd,
          windowsHide: true,
          ...(process.platform === "win32" ? {} : { detached: true }),
        },
        (err) => {
          if (timedOut) return finish("timeout");
          const c = (err as { code?: number } | null)?.code;
          if (err && typeof c === "number") return finish(c);
          if (err) return finish(-1);
          finish(0);
        }
      );
      handle.timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) this.killTree(child.pid);
      }, timeout);
      child.on("error", () => finish(-1));
    });
    if (code === "timeout") return this.result(check, false, now, "timeout");
    return this.result(check, code === expectExit, now, `exit ${code}`);
  }

  /** Best-effort kill of a child process and its descendants, cross-platform. */
  private killTree(pid: number): void {
    if (process.platform === "win32") {
      // taskkill /T terminates the process tree; /F forces it.
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {
        /* best effort: process may already be gone */
      });
    } else {
      try {
        // Negative pid targets the whole process group (requires detached spawn).
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already exited */
        }
      }
    }
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
