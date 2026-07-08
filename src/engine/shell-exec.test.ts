// src/engine/shell-exec.test.ts
import { describe, it, expect } from "bun:test";
import { runShell, killTree } from "./shell-exec.js";

describe("runShell", () => {
  it("captures stdout and a zero exit code", async () => {
    const r = await runShell("echo hera-out");
    expect(r.code).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toContain("hera-out");
  });

  it("reports a nonzero exit code", async () => {
    const r = await runShell("exit 3");
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(3);
  });

  it("times out, sets timedOut, and returns promptly (tree-kill)", async () => {
    // Windows: `sleep` is not a cmd.exe builtin; use ping to block reliably.
    const slow = process.platform === "win32" ? "ping -n 6 127.0.0.1 >NUL" : "sleep 5";
    const start = Date.now();
    const r = await runShell(slow, { timeoutMs: 50 });
    expect(r.timedOut).toBe(true);
    // Resolves after the tree-kill completes, well under the 5s command.
    expect(Date.now() - start).toBeLessThan(4000);
  });

  it("killTree tolerates a nonexistent pid", async () => {
    await expect(killTree(2 ** 30)).resolves.toBeUndefined();
  });
});
