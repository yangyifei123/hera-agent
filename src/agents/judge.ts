// src/agents/judge.ts
import type { AgentConfig } from "@opencode-ai/sdk";
import { JUDGE_MAX_STEPS } from "../constants.js";

/** Canonical name of the built-in acceptance judge agent. */
export const JUDGE_AGENT_NAME = "hera-judge";

const JUDGE_PROMPT = [
  "You are a strict, impartial acceptance judge.",
  "",
  "You receive a rubric, work output, and optionally evidence. Your only job",
  "is to score the work against each rubric criterion.",
  "",
  "Rules:",
  "- You have NO tools. Judge solely from the material in the prompt.",
  "- Be skeptical. Unsubstantiated claims of success are unproven.",
  "- Length is not quality.",
  "- Reason first, then score.",
  "- Respond with ONLY the JSON object the prompt requests — no prose, no",
  "  markdown fences, nothing else.",
].join("\n");

/**
 * Built-in zero-tool judge agent (spec §6). Injected by the config hook like
 * Hera itself — never persisted to disk, never in registeredAgents. Denies
 * every hera_* tool INCLUDING the dispatch meta-tools, and all shell/edit/web
 * permissions: the judge cannot act, only read its prompt and answer.
 */
export function createJudgeAgent(model: string, heraToolNames: string[]): AgentConfig {
  const tools: Record<string, boolean> = {
    hera_find_tools: false,
    hera_run_tool: false,
  };
  for (const name of heraToolNames) tools[name] = false;
  return {
    description: "Hera's built-in acceptance judge — zero tools, low temperature.",
    mode: "subagent",
    prompt: JUDGE_PROMPT,
    model,
    temperature: 0.1,
    maxSteps: JUDGE_MAX_STEPS,
    permission: { edit: "deny", bash: "deny", webfetch: "deny" },
    tools,
  };
}
