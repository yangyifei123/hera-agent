// src/program/index.ts
import { OpenCodeAgentRunner } from "../engine/opencode-agent-runner.js";
import { ProgramRunner as ProgramRunnerImpl } from "./runner.js";
import type { OpenCodeClient } from "../types/client.js";
import type { SkillManager } from "../skills/manager.js";
import type { ProgramRunner } from "../types.js";

export { ProgramRunner as ProgramRunnerImpl } from "./runner.js";

/** Build a ProgramRunner backed by an OpenCode-session AgentRunner for `llm`. */
export function createProgramRunner(opts: {
  client: OpenCodeClient | undefined;
  skillManager: SkillManager;
  skillsDir: string;
  directory: string;
  timeoutMs?: number;
}): ProgramRunner {
  const runner = new OpenCodeAgentRunner(opts.client, opts.directory);
  return new ProgramRunnerImpl({
    skillManager: opts.skillManager,
    skillsDir: opts.skillsDir,
    runner,
    timeoutMs: opts.timeoutMs,
  });
}
