// src/program/rpc.test.ts
import { describe, it, expect } from "bun:test";
import {
  isRequest,
  isResponse,
  isResult,
  isLog,
  type RpcRequest,
  type RpcResponse,
  type RpcResult,
  type RpcLog,
} from "./rpc.js";

describe("rpc framing", () => {
  it("discriminates a request frame", () => {
    const req: RpcRequest = { kind: "request", id: 1, method: "llm", params: { prompt: "hi" } };
    expect(isRequest(req)).toBe(true);
    expect(isResponse(req)).toBe(false);
    expect(isResult(req)).toBe(false);
    expect(isLog(req)).toBe(false);
  });

  it("discriminates a response frame", () => {
    const res: RpcResponse = { kind: "response", id: 1, ok: true, value: { title: "x" } };
    expect(isResponse(res)).toBe(true);
    expect(isRequest(res)).toBe(false);
  });

  it("discriminates a result frame", () => {
    const done: RpcResult = { kind: "result", ok: false, error: "boom" };
    expect(isResult(done)).toBe(true);
    expect(isLog(done)).toBe(false);
  });

  it("discriminates a log frame", () => {
    const log: RpcLog = { kind: "log", message: "progress" };
    expect(isLog(log)).toBe(true);
    expect(isResult(log)).toBe(false);
  });

  it("rejects a non-frame value", () => {
    expect(isRequest(null)).toBe(false);
    expect(isResponse(42)).toBe(false);
    expect(isResult("nope")).toBe(false);
    expect(isLog(undefined)).toBe(false);
  });
});
