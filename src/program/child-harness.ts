// src/program/child-harness.ts
// Runs INSIDE the child process. Builds the `hera` SDK (local sh/file, RPC llm),
// imports the skill's entry, calls default(hera, args), and posts a terminal
// Result. Bundled by the build (dist/program/child-harness.js).
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { runShell } from "../engine/shell-exec.js";
import type { ChildToParent, RpcResponse } from "./rpc.js";
import type { Hera } from "./sdk-types.js";

export interface HarnessChannel {
  send(message: ChildToParent): void;
  onResponse(handler: (res: RpcResponse) => void): void;
}

/** Reject any path that resolves outside the session directory. */
function resolveInDir(sessionDir: string, p: string): string {
  const resolved = isAbsolute(p) ? p : resolve(sessionDir, p);
  const rel = relative(sessionDir, resolved);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`path escapes session directory: ${p}`);
  }
  return resolved;
}

export function createHeraSdk(opts: {
  args: unknown;
  sessionDir: string;
  channel: HarnessChannel;
}): Hera {
  const { args, sessionDir, channel } = opts;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  channel.onResponse((res) => {
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new Error(res.error ?? "llm request failed"));
  });
  let nextId = 1;

  return {
    args,
    log(message: string) {
      channel.send({ kind: "log", message });
    },
    async sh(cmd, o) {
      const r = await runShell(cmd, { cwd: o?.cwd ?? sessionDir, timeoutMs: o?.timeoutMs });
      return { stdout: r.stdout, stderr: r.stderr, code: r.code };
    },
    file: {
      read: (p) => readFile(resolveInDir(sessionDir, p), "utf-8"),
      write: async (p, content) => {
        const abs = resolveInDir(sessionDir, p);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf-8");
      },
      exists: async (p) => {
        try {
          await access(resolveInDir(sessionDir, p));
          return true;
        } catch {
          return false;
        }
      },
      list: (p) => readdir(resolveInDir(sessionDir, p)),
    },
    llm(prompt, o) {
      const id = nextId++;
      return new Promise<unknown>((resolveLlm, rejectLlm) => {
        pending.set(id, { resolve: resolveLlm, reject: rejectLlm });
        channel.send({
          kind: "request",
          id,
          method: "llm",
          params: { prompt, input: o?.input, schema: o?.schema, executor: o?.executor },
        });
      });
    },
  };
}

function parseArgs(raw: string | undefined): unknown {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

/** Child bootstrap. Reads entry+args from env, runs the program, posts Result. */
export async function main(): Promise<void> {
  const channel: HarnessChannel = {
    send: (m) => process.send?.(m),
    onResponse: (h) => process.on("message", (msg) => h(msg as RpcResponse)),
  };
  const entry = process.env.HERA_PROGRAM_ENTRY;
  const sessionDir = process.cwd();
  const args = parseArgs(process.env.HERA_PROGRAM_ARGS);

  if (!entry) {
    channel.send({ kind: "result", ok: false, error: "no program entry provided" });
    return;
  }

  const hera = createHeraSdk({ args, sessionDir, channel });
  try {
    const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
    const run = mod.default;
    if (typeof run !== "function") {
      throw new Error("program entry has no default export function");
    }
    const value = await (run as (h: Hera, a: unknown) => unknown)(hera, args);
    channel.send({ kind: "result", ok: true, value });
  } catch (err) {
    channel.send({
      kind: "result",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // Intentionally do NOT disconnect/exit here: keep the IPC channel open so the
  // Result frame is delivered in order, and let the parent tear the child down
  // once it receives the Result (or on timeout).
}

// Bun sets import.meta.main only when this file is the process entry, so
// importing it from tests does not trigger the bootstrap.
if (import.meta.main) {
  void main();
}
