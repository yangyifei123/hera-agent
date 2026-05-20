import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  suggestTemplate,
  suggestMode,
  slugifyName,
  findAvailableName,
  createAgentTools,
} from "../tools/agent-tools.js";
import { makeTestHarness, type TestHarness } from "./test-harness.js";

describe("suggestTemplate", () => {
  it("maps code/program/develop keywords to coder", () => {
    expect(suggestTemplate("I need an agent to write code")).toBe("coder");
    expect(suggestTemplate("Build a program for data processing")).toBe("coder");
    expect(suggestTemplate("Develop new features")).toBe("coder");
  });

  it("maps review/audit/check to reviewer", () => {
    expect(suggestTemplate("Review my code for bugs")).toBe("reviewer");
    expect(suggestTemplate("Audit security of the project")).toBe("reviewer");
    expect(suggestTemplate("Check code quality")).toBe("reviewer");
  });

  it("maps research/investigate/find to researcher", () => {
    expect(suggestTemplate("Research best practices for REST APIs")).toBe("researcher");
    expect(suggestTemplate("Investigate the root cause of the crash")).toBe("researcher");
    expect(suggestTemplate("Find solutions for caching strategies")).toBe("researcher");
  });

  it("maps test/QA/quality to tester", () => {
    expect(suggestTemplate("Write test cases for the module")).toBe("tester");
    expect(suggestTemplate("QA the new feature")).toBe("tester");
    expect(suggestTemplate("Ensure quality of the release")).toBe("tester");
  });

  it("maps document/write/explain to documenter", () => {
    expect(suggestTemplate("Document the API endpoints")).toBe("documenter");
    expect(suggestTemplate("Write README for the project")).toBe("documenter");
    expect(suggestTemplate("Explain the architecture")).toBe("documenter");
  });

  it("maps optimize/performance/speed to optimizer", () => {
    expect(suggestTemplate("Optimize database queries")).toBe("optimizer");
    expect(suggestTemplate("Improve performance of the service")).toBe("optimizer");
    expect(suggestTemplate("Speed up request handling")).toBe("optimizer");
  });

  it("maps debug/fix/troubleshoot to debugger", () => {
    expect(suggestTemplate("Debug the memory leak issue")).toBe("debugger");
    expect(suggestTemplate("Fix the broken authentication flow")).toBe("debugger");
    expect(suggestTemplate("Troubleshoot the connection timeout")).toBe("debugger");
  });

  it("maps design/architecture/plan to architect", () => {
    expect(suggestTemplate("Design the microservices architecture")).toBe("architect");
    expect(suggestTemplate("Plan the system migration")).toBe("architect");
  });

  it("maps coordinate/manage/organize to coordinator", () => {
    expect(suggestTemplate("Coordinate the team workflow")).toBe("coordinator");
    expect(suggestTemplate("Manage the deployment pipeline")).toBe("coordinator");
    expect(suggestTemplate("Organize the project tasks")).toBe("coordinator");
  });

  it("defaults to general for unrecognized input", () => {
    expect(suggestTemplate("Help me with random stuff")).toBe("general");
    expect(suggestTemplate("")).toBe("general");
    expect(suggestTemplate("Do something cool")).toBe("general");
  });

  it("is case-insensitive", () => {
    expect(suggestTemplate("CODE the backend")).toBe("coder");
    expect(suggestTemplate("REVIEW the pull request")).toBe("reviewer");
    expect(suggestTemplate("Test the feature")).toBe("tester");
  });
});

describe("suggestMode", () => {
  it("subagent for reviewer, tester, documenter, optimizer", () => {
    expect(suggestMode("reviewer")).toBe("subagent");
    expect(suggestMode("tester")).toBe("subagent");
    expect(suggestMode("documenter")).toBe("subagent");
    expect(suggestMode("optimizer")).toBe("subagent");
  });

  it("all for coder, researcher, coordinator, architect, debugger, general", () => {
    expect(suggestMode("coder")).toBe("all");
    expect(suggestMode("researcher")).toBe("all");
    expect(suggestMode("coordinator")).toBe("all");
    expect(suggestMode("architect")).toBe("all");
    expect(suggestMode("debugger")).toBe("all");
    expect(suggestMode("general")).toBe("all");
  });
});

describe("slugifyName", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyName("My Cool Agent")).toBe("my-cool-agent");
  });

  it("removes special characters", () => {
    expect(slugifyName("Agent@#$% Name!")).toBe("agent-name");
  });

  it("handles camelCase", () => {
    expect(slugifyName("codeReviewer")).toBe("code-reviewer");
  });

  it("collapses multiple hyphens", () => {
    expect(slugifyName("hello  world--test")).toBe("hello-world-test");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyName("--hello--")).toBe("hello");
  });

  it("ensures starts with letter", () => {
    expect(slugifyName("123-agent")).toBe("agent-123-agent");
  });

  it("handles empty input", () => {
    expect(slugifyName("")).toBe("agent");
  });

  it("handles purely special chars", () => {
    expect(slugifyName("@#$%")).toBe("agent");
  });
});

describe("findAvailableName", () => {
  it("returns original name if available", () => {
    const existing = new Map<string, unknown>();
    expect(findAvailableName("my-agent", existing)).toBe("my-agent");
  });

  it("appends number if name taken", () => {
    const existing = new Map<string, unknown>();
    existing.set("my-agent", {});
    expect(findAvailableName("my-agent", existing)).toBe("my-agent-2");
  });

  it("increments number until available", () => {
    const existing = new Map<string, unknown>();
    existing.set("my-agent", {});
    existing.set("my-agent-2", {});
    existing.set("my-agent-3", {});
    expect(findAvailableName("my-agent", existing)).toBe("my-agent-4");
  });
});

// ============================================================
// Integration tests for createAgentTools
// ============================================================
describe("createAgentTools (integration)", () => {
  let harness: TestHarness;
  let tools: ReturnType<typeof createAgentTools>;

  beforeEach(async () => {
    harness = await makeTestHarness();
    tools = createAgentTools(harness.ctx);
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  describe("hera_create_agent (md mode)", () => {
    it("creates an agent .md file and registers it in-memory", async () => {
      const result = await tools.hera_create_agent.execute(
        {
          name: "test-coder",
          description: "Test coder",
          prompt: "You write tests.",
          mode: "subagent",
        } as any,
        {} as any
      );

      expect(String(result)).toContain('"test-coder" created');
      expect(harness.ctx.registeredAgents.has("test-coder")).toBe(true);

      const files = await readdir(harness.ctx.paths.agentsDir);
      expect(files).toContain("test-coder.md");

      const md = await readFile(join(harness.ctx.paths.agentsDir, "test-coder.md"), "utf-8");
      // .md must contain the full assembled prompt with built-in skills.
      expect(md).toContain("Caveman Mode");
      expect(md).toContain("Autonomous Knowledge");
      expect(md).toContain("Self-Improvement");
    });

    it("rejects invalid agent names", async () => {
      const result = await tools.hera_create_agent.execute(
        {
          name: "BAD NAME",
          description: "x",
          prompt: "x",
          mode: "all",
        } as any,
        {} as any
      );
      expect(String(result)).toContain("Error");
    });

    it("rejects duplicate agent names with a useful suggestion", async () => {
      await tools.hera_create_agent.execute(
        {
          name: "dup",
          description: "first",
          prompt: "x",
          mode: "subagent",
        } as any,
        {} as any
      );
      const result = await tools.hera_create_agent.execute(
        {
          name: "dup",
          description: "second",
          prompt: "x",
          mode: "subagent",
        } as any,
        {} as any
      );
      expect(String(result)).toContain("Error");
    });

    it("applies a template when one is requested", async () => {
      const result = await tools.hera_create_agent.execute(
        {
          name: "audit-bot",
          description: "Audits security",
          prompt: "",
          mode: "subagent",
          template: "reviewer",
        } as any,
        {} as any
      );
      expect(String(result)).toContain("audit-bot");
      const def = harness.ctx.registeredAgents.get("audit-bot");
      expect(def?.template).toBe("reviewer");
    });
  });

  describe("hera_create_agent (plugin mode)", () => {
    it("writes a plugin package to agents/hera-generated", async () => {
      const result = await tools.hera_create_agent.execute(
        {
          name: "plugin-bot",
          description: "Plugin form",
          prompt: "You are a plugin bot.",
          mode: "subagent",
          format: "plugin",
        } as any,
        {} as any
      );

      expect(String(result)).toContain("plugin-bot");
      const generatedDir = join(
        harness.ctx.paths.configRoot,
        "agents",
        "hera-generated",
        "plugin-bot"
      );
      const entries = await readdir(generatedDir);
      expect(entries).toContain("package.json");
      expect(entries).toContain("tsconfig.json");
      expect(entries).toContain("INSTALL.md");

      const indexContent = await readFile(join(generatedDir, "src", "index.ts"), "utf-8");
      expect(indexContent).toContain("plugin-bot");
      expect(indexContent).toContain("hera_remember");
      expect(indexContent).toContain("Caveman Mode");
    });
  });

  describe("hera_list_agents", () => {
    it("returns 'No agents' when registry is empty", async () => {
      const result = await tools.hera_list_agents.execute({} as any, {} as any);
      expect(String(result)).toContain("No agents created yet");
    });

    it("lists created agents with metadata", async () => {
      await tools.hera_create_agent.execute(
        {
          name: "alpha",
          description: "Alpha agent",
          prompt: "x",
          mode: "subagent",
        } as any,
        {} as any
      );
      const result = await tools.hera_list_agents.execute({} as any, {} as any);
      expect(String(result)).toContain("alpha");
      expect(String(result)).toContain("Alpha agent");
    });

    it("filters by mode", async () => {
      await tools.hera_create_agent.execute(
        {
          name: "alpha",
          description: "x",
          prompt: "x",
          mode: "subagent",
        } as any,
        {} as any
      );
      await tools.hera_create_agent.execute(
        {
          name: "beta",
          description: "x",
          prompt: "x",
          mode: "primary",
        } as any,
        {} as any
      );
      const result = await tools.hera_list_agents.execute({ mode: "primary" } as any, {} as any);
      expect(String(result)).toContain("beta");
      expect(String(result)).not.toContain("- **alpha**");
    });
  });

  describe("hera_delete_agent", () => {
    it("removes an agent from registry + disk", async () => {
      await tools.hera_create_agent.execute(
        {
          name: "gonna-die",
          description: "x",
          prompt: "x",
          mode: "subagent",
        } as any,
        {} as any
      );
      expect(harness.ctx.registeredAgents.has("gonna-die")).toBe(true);

      await tools.hera_delete_agent.execute({ name: "gonna-die" } as any, {} as any);
      expect(harness.ctx.registeredAgents.has("gonna-die")).toBe(false);

      const files = await readdir(harness.ctx.paths.agentsDir);
      expect(files).not.toContain("gonna-die.md");
    });
  });

  describe("hera_verify_agent", () => {
    it("reports details for a registered agent", async () => {
      await tools.hera_create_agent.execute(
        {
          name: "verified",
          description: "Audit me",
          prompt: "x",
          mode: "all",
        } as any,
        {} as any
      );
      const result = await tools.hera_verify_agent.execute({ name: "verified" } as any, {} as any);
      expect(String(result)).toContain("verified");
    });

    it("returns an error for missing agent", async () => {
      const result = await tools.hera_verify_agent.execute({ name: "ghost" } as any, {} as any);
      expect(String(result)).toContain("not");
    });
  });
});
