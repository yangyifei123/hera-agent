// src/program/rpc.ts
// Message protocol shared by the parent ProgramRunner and the child harness.
// Transport is Bun IPC (structured-clone), so frames are plain objects; these
// guards let each side discriminate incoming frames by their `kind`.

export interface LlmParams {
  prompt: string;
  input?: unknown;
  schema?: object;
  executor?: string;
}

/** Child -> parent: "run this prompt through the LLM and reply". */
export interface RpcRequest {
  kind: "request";
  id: number;
  method: "llm";
  params: LlmParams;
}

/** Parent -> child: the reply to one RpcRequest, keyed by `id`. */
export interface RpcResponse {
  kind: "response";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Child -> parent: a progress log line (accumulated into ProgramResult.logs). */
export interface RpcLog {
  kind: "log";
  message: string;
}

/** Child -> parent: the terminal outcome of the program. */
export interface RpcResult {
  kind: "result";
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type ChildToParent = RpcRequest | RpcResult | RpcLog;
export type ParentToChild = RpcResponse;

function hasKind(v: unknown): v is { kind: string } {
  return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
}

export function isRequest(v: unknown): v is RpcRequest {
  return hasKind(v) && v.kind === "request";
}

export function isResponse(v: unknown): v is RpcResponse {
  return hasKind(v) && v.kind === "response";
}

export function isResult(v: unknown): v is RpcResult {
  return hasKind(v) && v.kind === "result";
}

export function isLog(v: unknown): v is RpcLog {
  return hasKind(v) && v.kind === "log";
}
