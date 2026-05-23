import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRegistry } from "./registry.js";
import type { AgentDefinition, SkillDefinition } from "../types.js";

describe("AgentRegistry metadata round-trip", () => {
  let tmp: string;
  let registry: AgentRegistry;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "hera-registry-test-"));
    registry = new AgentRegistry(tmp);
    await registry.init();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("persists custom skills, tools, permission, evolution log, and workflow", async () => {
    const def: AgentDefinition = {
      name: "metadata-agent",
      description: "Metadata agent",
      mode: "all",
      prompt: "You preserve metadata.",
      model: "test/model",
      skills: ["caveman", "custom-skill"],
      tools: { bash: true, webfetch: false },
      permission: { edit: "allow", bash: "ask" },
      maxSteps: 42,
      createdAt: 1234,
      evolvedAt: 5678,
      evolutionLog: [
        {
          timestamp: 5678,
          trigger: "test",
          observation: "metadata was missing",
          directive: "preserve metadata",
          rolledBack: false,
        },
      ],
      workflow: {
        id: "wf-1",
        name: "Metadata workflow",
        description: "Round trip workflow",
        mode: "serial",
        steps: [{ id: "step-1", name: "Step 1", type: "agent", executor: "metadata-agent" }],
        createdAt: 9999,
      },
    };
    const skills = new Map<string, SkillDefinition>([
      [
        "custom-skill",
        {
          name: "custom-skill",
          description: "Custom",
          trigger: "test",
          prompt: "Custom prompt",
          category: "user",
        },
      ],
    ]);

    await registry.register(def, skills);
    const read = await registry.readDefinition("metadata-agent");

    expect(read).toBeDefined();
    expect(read!.skills).toEqual(def.skills);
    expect(read!.tools).toEqual(def.tools);
    expect(read!.permission).toEqual(def.permission);
    expect(read!.evolutionLog).toEqual(def.evolutionLog);
    expect(read!.workflow).toEqual(def.workflow);
    expect(read!.maxSteps).toBe(42);
    expect(read!.model).toBe("test/model");
  });

  it("falls back to default skills for legacy markdown without metadata json", async () => {
    const legacy = [
      "---",
      "name: legacy-agent",
      'description: "Legacy"',
      "mode: subagent",
      "---",
      "Legacy prompt",
    ].join("\n");

    await Bun.write(join(tmp, "legacy-agent.md"), legacy);
    const read = await registry.readDefinition("legacy-agent");

    expect(read).toBeDefined();
    expect(read!.skills).toContain("caveman");
    expect(read!.prompt).toContain("Legacy prompt");
  });

  it("ignores malformed permission metadata", async () => {
    const malformed = [
      "---",
      "name: malformed-agent",
      'description: "Malformed"',
      "mode: subagent",
      'permissionJson: {"edit":"allow","bash":{"unexpected":true}}',
      "---",
      "Malformed prompt",
    ].join("\n");

    await Bun.write(join(tmp, "malformed-agent.md"), malformed);
    const read = await registry.readDefinition("malformed-agent");

    expect(read).toBeDefined();
    expect(read!.permission).toBeUndefined();
  });
});
