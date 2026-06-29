import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createMemoryTools } from "./memory-tools.js";
import { makeTestHarness, type TestHarness } from "./test-harness.js";

describe("createMemoryTools", () => {
  let harness: TestHarness;
  let tools: ReturnType<typeof createMemoryTools>;
  beforeEach(async () => {
    harness = await makeTestHarness();
    tools = createMemoryTools(harness.ctx);
  });
  afterEach(async () => {
    await harness.cleanup();
  });

  it("dedups byte-identical hera_remember content", async () => {
    for (let i = 0; i < 3; i++) {
      await tools.hera_remember.execute(
        { content: "identical abc", category: "fix" } as any,
        {} as any
      );
    }
    expect(await harness.ctx.store.list("fix")).toHaveLength(1);
  });

  it("clamps a negative recall limit instead of returning empty", async () => {
    await tools.hera_remember.execute(
      { content: "alpha note", category: "decision" } as any,
      {} as any
    );
    await tools.hera_remember.execute(
      { content: "beta note", category: "decision" } as any,
      {} as any
    );
    const res = String(
      await tools.hera_recall.execute({ query: "note", limit: -2 } as any, {} as any)
    );
    expect(res).not.toContain("No matching");
    expect(res).toContain("note");
  });

  it("excludes infra agent/team backups from a category-less recall", async () => {
    // persistAgent stores a fallback agent-definition copy in the same store.
    await harness.ctx.store.save({
      id: "agent-blobby",
      type: "agent",
      content: "agent definition blob containing the word error",
      timestamp: Date.now(),
    });
    await tools.hera_remember.execute(
      { content: "real user error note", category: "fix" } as any,
      {} as any
    );
    const res = String(await tools.hera_recall.execute({ query: "error" } as any, {} as any));
    expect(res).toContain("real user error note");
    expect(res).not.toContain("agent definition blob");
  });

  it("still returns agent backups when that category is explicitly requested", async () => {
    await harness.ctx.store.save({
      id: "agent-blobby2",
      type: "agent",
      content: "explicit agent error blob",
      timestamp: Date.now(),
    });
    const res = String(
      await tools.hera_recall.execute({ query: "error", category: "agent" } as any, {} as any)
    );
    expect(res).toContain("explicit agent error blob");
  });
});
