import { describe, test, expect } from "bun:test";
import type { OpenCodeClient } from "./client.js";

describe("OpenCodeClient SDK type alias", () => {
  test("session.create accepts the current SDK body/query envelope", () => {
    type CreateOptions = NonNullable<Parameters<OpenCodeClient["session"]["create"]>[0]>;

    const options = {
      body: { title: "test-session" },
      query: { directory: process.cwd() },
    } satisfies CreateOptions;

    expect(options.body.title).toBe("test-session");
    expect(options.query.directory).toBe(process.cwd());
  });

  test("promptAsync accepts path.id and body with agent + text parts", () => {
    type PromptOptions = Parameters<OpenCodeClient["session"]["promptAsync"]>[0];

    const options = {
      path: { id: "session-id" },
      body: {
        agent: "test-agent",
        parts: [{ type: "text" as const, text: "test prompt" }],
      },
    } satisfies PromptOptions;

    expect(options.path.id).toBe("session-id");
    expect(options.body.agent).toBe("test-agent");
    expect(options.body.parts[0].type).toBe("text");
  });

  test("status and messages methods stay available on the SDK client", () => {
    type StatusOptions = Parameters<OpenCodeClient["session"]["status"]>[0];
    type MessagesOptions = Parameters<OpenCodeClient["session"]["messages"]>[0];

    const statusOptions = {} satisfies NonNullable<StatusOptions>;
    const messagesOptions = { path: { id: "session-id" } } satisfies MessagesOptions;

    expect(statusOptions).toBeDefined();
    expect(messagesOptions.path.id).toBe("session-id");
  });
});
