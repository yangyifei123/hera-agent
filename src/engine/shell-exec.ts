// src/engine/shell-exec.ts
import { exec, execFile } from "node:child_process";

/**
 * Upper bound on how long a timed-out shell command waits for the process-tree
 * kill to complete before resolving anyway. Keeps a wedged taskkill from
 * stalling the caller.
 */
export const KILL_TREE_WAIT_MS = 2000;

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

/**
 * Best-effort kill of a child process (and, on Windows, its tree). Resolves once
 * the kill has been issued and — on Windows — taskkill has exited, i.e. the tree
 * is actually gone and its file handles are released.
 */
export function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    // taskkill /T terminates the process tree (e.g. cmd.exe + its `ping` child);
    // /F forces it.
    return new Promise((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => resolve());
    });
  }
  // Direct SIGKILL of the spawned `sh -c ...` child. We intentionally do NOT
  // spawn detached / kill a negative process group: under Bun a detached child
  // can keep the runtime from exiting cleanly.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already exited */
  }
  return Promise.resolve();
}

/**
 * Run a shell command with captured output and a manual timeout + process-tree
 * kill. Node's built-in exec `timeout` only signals the top-level shell; on
 * Windows `cmd.exe /c` does not propagate the kill to its children, leaking the
 * grandchild (e.g. a blocking `ping`) which keeps holding `cwd`. On timeout we
 * kill the whole tree, wait (bounded) for the kill to complete, then resolve.
 */
export function runShell(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? 0;
  return new Promise<ShellResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    };

    const child = exec(cmd, { cwd: opts.cwd, windowsHide: true }, (err) => {
      // The timeout branch owns the resolve; a post-kill callback here (which may
      // never arrive under Bun after SIGKILL) must not overwrite it.
      if (timedOut) return;
      const c = (err as { code?: number } | null)?.code;
      if (err && typeof c === "number") return finish(c);
      if (err) return finish(-1);
      finish(0);
    });

    // Accumulate incrementally so a timed-out command still yields partial output.
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        // Kill the tree, then a direct fallback SIGKILL AFTER the tree kill: on
        // Windows, killing cmd.exe before taskkill snapshots its children orphans
        // them (a blocking `ping` keeps holding cwd → EBUSY on cleanup).
        const treeKilled = (child.pid ? killTree(child.pid) : Promise.resolve()).then(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        });
        const cap = setTimeout(() => finish(-1), KILL_TREE_WAIT_MS);
        void treeKilled.then(() => {
          clearTimeout(cap);
          finish(-1);
        });
      }, timeoutMs);
    }

    child.on("error", () => finish(-1));
  });
}
