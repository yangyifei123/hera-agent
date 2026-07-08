// src/program/child-harness.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeraSdk, type HarnessChannel } from "./child-harness.js";
import type { ChildToParent, RpcResponse } from "./rpc.js";

function makeChannel() {
  const sent: ChildToParent[] = [];
  let handler: ((res: RpcResponse) => void) | undefined;
  const channel: HarnessChannel = {
    send: (m) => sent.push(m),
    onResponse: (h) => {
      handler = h;
    },
  };
  return { channel, sent, respond: (res: RpcResponse) => handler?.(res) };
}

describe("createHeraSdk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "harness-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("exposes invocation args", () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: { a: 1 }, sessionDir: dir, channel });
    expect(hera.args).toEqual({ a: 1 });
  });

  it("runs sh locally and returns stdout/code", async () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    const r = await hera.sh("echo harness-ok");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("harness-ok");
  });

  it("writes, reads, checks existence, and lists files in the session dir", async () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    await hera.file.write("sub/data.txt", "hello");
    expect(await hera.file.exists("sub/data.txt")).toBe(true);
    expect(await hera.file.read("sub/data.txt")).toBe("hello");
    expect(await hera.file.list("sub")).toContain("data.txt");
  });

  it("path-guards file access outside the session dir", async () => {
    const { channel } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    await expect(hera.file.write("../escape.txt", "x")).rejects.toThrow(/escapes/);
  });

  it("log() sends a log frame", () => {
    const { channel, sent } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    hera.log("progress");
    expect(sent).toContainEqual({ kind: "log", message: "progress" });
  });

  it("llm() sends a request and resolves on the matching response", async () => {
    const { channel, sent, respond } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    const p = hera.llm("write notes", { schema: { type: "object" } });
    const req = sent.find((m) => m.kind === "request");
    expect(req).toBeDefined();
    respond({ kind: "response", id: (req as { id: number }).id, ok: true, value: { title: "T" } });
    expect(await p).toEqual({ title: "T" });
  });

  it("llm() rejects when the response is ok:false", async () => {
    const { channel, sent, respond } = makeChannel();
    const hera = createHeraSdk({ args: null, sessionDir: dir, channel });
    const p = hera.llm("x");
    const req = sent.find((m) => m.kind === "request");
    respond({ kind: "response", id: (req as { id: number }).id, ok: false, error: "llm failed" });
    await expect(p).rejects.toThrow("llm failed");
  });
});
