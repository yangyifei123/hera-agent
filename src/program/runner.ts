// src/program/runner.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { heraLog } from "../logger.js";
import { killTree } from "../engine/shell-exec.js";
import { PROGRAM_TOTAL_TIMEOUT_MS } from "../constants.js";
import type { AgentRunner } from "../engine/executor.js";
import type { SkillManager } from "../skills/manager.js";
import type {
  ProgramResult,
  ProgramRunner as ProgramRunnerContract,
  SessionCtx,
} from "../types.js";
import {
  isLog,
  isRequest,
  isResult,
  type ChildToParent,
  type RpcRequest,
  type RpcResult,
} from "./rpc.js";

export interface ProgramRunnerDeps {
  skillManager: Pick<SkillManager, "getSkillPackage">;
  skillsDir: string;
  runner: AgentRunner;
  /** Path to the child harness. Defaults to the sibling/dist bundle. */
  harnessPath?: string;
  timeoutMs?: number;
}

/** Resolve the child harness: sibling .ts in source/tests, bundled .js in dist. */
function defaultHarnessPath(): string {
  const tsSibling = join(import.meta.dir, "child-harness.ts");
  if (existsSync(tsSibling)) return tsSibling;
  // Bundled: runner.ts is inlined into dist/index.js, so import.meta.dir is dist.
  return join(import.meta.dir, "program", "child-harness.js");
}

/** Templated prompt: prompt plus an optional Input block, matching task prompts. */
function buildLlmPrompt(prompt: string, input: unknown): string {
  if (input == null) return prompt;
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return `${prompt}\n\nInput:\n${text}`;
}

/**
 * Minimal structured-output enforcement: extract the JSON object from the reply,
 * parse it, and check top-level required keys. Mirrors the tolerant brace
 * extraction the acceptance judge uses; throws so the child rethrows to the author.
 */
function parseStructured(text: string, schema: Record<string, unknown>): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("llm did not return a JSON object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("llm returned invalid JSON");
  }
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const obj = parsed as Record<string, unknown>;
  for (const key of required) {
    if (!(key in obj)) throw new Error(`llm output missing required field: ${key}`);
  }
  return parsed;
}

function toProgramResult(result: RpcResult, logs: string[]): ProgramResult {
  if (result.ok) return { ok: true, value: result.value, logs };
  return { ok: false, error: result.error ?? "program failed", logs };
}

export class ProgramRunner implements ProgramRunnerContract {
  constructor(private deps: ProgramRunnerDeps) {}

  run(skillName: string, args: unknown, ctx: SessionCtx): Promise<ProgramResult> {
    const logs: string[] = [];
    const pkg = this.deps.skillManager.getSkillPackage(skillName);
    if (!pkg || !pkg.program) {
      return Promise.resolve({
        ok: false,
        error: `skill "${skillName}" is not a program skill`,
        logs,
      });
    }
    const entry = join(this.deps.skillsDir, skillName, pkg.program);
    if (!existsSync(entry)) {
      return Promise.resolve({ ok: false, error: `program entry not found: ${entry}`, logs });
    }
    const harness = this.deps.harnessPath ?? defaultHarnessPath();
    const timeoutMs = this.deps.timeoutMs ?? PROGRAM_TOTAL_TIMEOUT_MS;

    return new Promise<ProgramResult>((resolve) => {
      let settled = false;
      let result: RpcResult | undefined;

      const finish = (r: ProgramResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Tear down the child tree once we have an answer (Result, timeout, or exit),
        // and wait for the kill to complete before resolving: the caller may tear
        // down the session directory right after `run()` resolves, and on Windows
        // that races the OS releasing the child's cwd handle if we resolve first.
        void killTree(child.pid)
          .then(() => {
            try {
              child.kill();
            } catch {
              /* already gone */
            }
          })
          .finally(() => resolve(r));
      };

      const child = Bun.spawn(["bun", "run", harness], {
        cwd: ctx.directory,
        env: {
          ...process.env,
          HERA_PROGRAM_ENTRY: entry,
          HERA_PROGRAM_ARGS: JSON.stringify(args ?? null),
          HERA_SESSION_ID: ctx.sessionID,
        },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        serialization: "advanced",
        ipc: (message: unknown) => {
          const frame = message as ChildToParent;
          if (isLog(frame)) {
            logs.push(frame.message);
            heraLog("info", `[program ${skillName}] ${frame.message}`);
            return;
          }
          if (isRequest(frame)) {
            void this.handleLlm(child, frame);
            return;
          }
          if (isResult(frame)) {
            result = frame;
            finish(toProgramResult(frame, logs));
          }
        },
        onExit: (_proc, code) => {
          if (settled) return;
          if (result) {
            finish(toProgramResult(result, logs));
            return;
          }
          void stderr.then((se) =>
            finish({
              ok: false,
              error: `program exited (code ${code}) without result${se.trim() ? `: ${se.trim()}` : ""}`,
              logs,
            })
          );
        },
      });

      const stderr = child.stderr
        ? new Response(child.stderr as ReadableStream).text()
        : Promise.resolve("");

      const timer = setTimeout(
        () => finish({ ok: false, error: `program timed out after ${timeoutMs}ms`, logs }),
        timeoutMs
      );
    });
  }

  private async handleLlm(child: Bun.Subprocess, req: RpcRequest): Promise<void> {
    try {
      const prompt = buildLlmPrompt(req.params.prompt, req.params.input);
      const text = await this.deps.runner.run(req.params.executor ?? "hera", prompt);
      const value = req.params.schema
        ? parseStructured(text, req.params.schema as Record<string, unknown>)
        : text;
      child.send({ kind: "response", id: req.id, ok: true, value });
    } catch (err) {
      child.send({
        kind: "response",
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
