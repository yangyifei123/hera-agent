import { describe, test, expect } from "bun:test";
import type { OpenCodeClient } from "./client.js";

describe("OpenCodeClient interface", () => {
  test("session.create signature accepts body and query", () => {
    // Type-check that interface matches actual API usage pattern
    const mockClient: OpenCodeClient = {
      session: {
        create: async (args) => {
          expect(args.body).toBeDefined();
          expect(args.query).toBeDefined();
          return { data: { id: "test-session-id" } };
        },
        promptAsync: async () => {},
        status: async () => ({ data: { status: "completed" } }),
        messages: async () => ({ data: [] }),
      },
    };

    expect(mockClient.session.create).toBeDefined();
  });

  test("session.create can return data.id or data directly", () => {
    // Both SDK versions return shapes that match the actual usage pattern
    const mockV1: OpenCodeClient = {
      session: {
        create: async () => ({ data: { id: "session-123" } }),
        promptAsync: async () => {},
        status: async () => ({ data: { status: "idle" } }),
        messages: async () => ({ data: [] }),
      },
    };

    const mockV2: OpenCodeClient = {
      session: {
        create: async () => ({ data: "session-456" }),
        promptAsync: async () => {},
        status: async () => ({ data: { status: "idle" } }),
        messages: async () => ({ data: [] }),
      },
    };

    // Both are valid OpenCodeClient implementations
    expect(mockV1.session.create).toBeDefined();
    expect(mockV2.session.create).toBeDefined();
  });

  test("promptAsync accepts path.id and body with agent + parts", () => {
    const mockClient: OpenCodeClient = {
      session: {
        create: async () => ({ data: { id: "test" } }),
        promptAsync: async (args) => {
          expect(args.path.id).toBeDefined();
          expect(args.body.agent).toBeDefined();
          expect(args.body.parts).toBeInstanceOf(Array);
        },
        status: async () => ({ data: { status: "idle" } }),
        messages: async () => ({ data: [] }),
      },
    };

    // Should accept actual usage pattern from team/manager.ts:153-156
    mockClient.session.promptAsync({
      path: { id: "session-id" },
      body: {
        agent: "test-agent",
        parts: [{ type: "text", text: "test prompt" }],
      },
    });
  });

  test("status returns status string in data", () => {
    const mockClient: OpenCodeClient = {
      session: {
        create: async () => ({ data: { id: "test" } }),
        promptAsync: async () => {},
        status: async () => ({ data: { status: "completed" } }),
        messages: async () => ({ data: [] }),
      },
    };

    expect(mockClient.session.status).toBeDefined();
  });

  test("messages returns array with role and parts", () => {
    const mockClient: OpenCodeClient = {
      session: {
        create: async () => ({ data: { id: "test" } }),
        promptAsync: async () => {},
        status: async () => ({ data: { status: "idle" } }),
        messages: async () => ({
          data: [
            { role: "user", parts: [{ text: "prompt" }] },
            { role: "assistant", parts: [{ text: "response" }] },
          ],
        }),
      },
    };

    expect(mockClient.session.messages).toBeDefined();
  });
});
