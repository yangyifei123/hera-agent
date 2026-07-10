// src/tools/command-tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandTools } from "./command-tools.js";
import type { PluginContext } from "../types.js";

function ctxWith(configRoot: string, agents: string[] = []): PluginContext {
  return {
    paths: { configRoot },
    registeredAgents: new Map(agents.map((a) => [a, {}])),
  } as unknown as PluginContext;
}
const TOOL_CTX = {} as never;

describe("command-tools", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cmdtools-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a command file routing /name to the agent", async () => {
    const tools = createCommandTools(ctxWith(dir, ["socrates"]));
    const out = await tools.hera_create_command.execute(
      { name: "socrates", agent: "socrates", description: "Consult Socrates" } as never,
      TOOL_CTX
    );
    expect(String(out)).toContain("/socrates");
    expect(String(out)).not.toContain("not a Hera-registered agent");
    const md = await readFile(join(dir, "command", "socrates.md"), "utf-8");
    expect(md).toContain("agent: socrates");
    expect(md).toContain("$ARGUMENTS");
  });

  it("notes when the agent is not registered but still creates the file", async () => {
    const tools = createCommandTools(ctxWith(dir, []));
    const out = await tools.hera_create_command.execute(
      { name: "plato", agent: "plato", description: "Ask Plato" } as never,
      TOOL_CTX
    );
    expect(String(out)).toContain("not a Hera-registered agent");
    expect(await readFile(join(dir, "command", "plato.md"), "utf-8")).toContain("agent: plato");
  });

  it("rejects an unsafe command name and writes nothing", async () => {
    const tools = createCommandTools(ctxWith(dir));
    const out = await tools.hera_create_command.execute(
      { name: "../escape", agent: "x", description: "d" } as never,
      TOOL_CTX
    );
    expect(String(out)).toContain("Error");
  });

  it("uses a custom body when provided", async () => {
    const tools = createCommandTools(ctxWith(dir, ["aristotle"]));
    await tools.hera_create_command.execute(
      {
        name: "aristotle",
        agent: "aristotle",
        description: "d",
        body: "Explain the logic.",
      } as never,
      TOOL_CTX
    );
    const md = await readFile(join(dir, "command", "aristotle.md"), "utf-8");
    expect(md).toContain("Explain the logic.");
    expect(md).not.toContain("$ARGUMENTS");
  });

  it("lists and deletes commands", async () => {
    const tools = createCommandTools(ctxWith(dir, ["socrates"]));
    await tools.hera_create_command.execute(
      { name: "socrates", agent: "socrates", description: "d" } as never,
      TOOL_CTX
    );
    expect(String(await tools.hera_list_commands.execute({} as never, TOOL_CTX))).toContain(
      "/socrates"
    );
    expect(
      String(await tools.hera_delete_command.execute({ name: "socrates" } as never, TOOL_CTX))
    ).toContain("Deleted");
    expect(String(await tools.hera_list_commands.execute({} as never, TOOL_CTX))).toContain(
      "No command files found"
    );
  });
});
