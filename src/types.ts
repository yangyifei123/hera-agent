// Hera Agent - Core Types

import type { AgentConfig } from "@opencode-ai/sdk";

export type AgentMode = "primary" | "subagent" | "all";

export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
};

export interface HeraMemory {
  id: string;
  type: "session" | "skill" | "agent" | "team" | "distillation";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SkillDefinition {
  name: string;
  description: string;
  trigger: string;
  prompt: string;
  intensity?: "lite" | "full" | "ultra" | "wenyan-lite" | "wenyan-full" | "wenyan-ultra";
}

export interface AgentDefinition {
  name: string;
  description: string;
  mode: AgentMode;
  prompt: string;
  model?: string;
  skills: string[];
  tools?: Record<string, boolean>;
  permission?: AgentConfig["permission"];
  maxSteps?: number;
}

export interface TeamDefinition {
  name: string;
  description: string;
  members: TeamMember[];
  coordination: "parallel" | "sequential" | "adaptive";
}

export interface TeamMember {
  agentName: string;
  role: string;
  subscriptions: string[];
  backendType: "in-process" | "tmux";
  worktreePath?: string;
}

export interface DistillationResult {
  summary: string;
  keyDecisions: string[];
  skillsExtracted: string[];
  patternsLearned: string[];
}

export interface HeraConfig {
  disabled_agents?: string[];
  disabled_skills?: string[];
  disabled_tools?: string[];
  agent_overrides?: Record<string, Partial<AgentConfig> & { prompt_append?: string }>;
  categories?: Record<string, CategoryConfig>;
  default_model?: string;
  memory_dir?: string;
}

export interface CategoryConfig {
  model?: string;
  description?: string;
  temperature?: number;
  thinking?: { type: string; budgetTokens?: number };
}
