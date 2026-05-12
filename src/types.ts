import type { AgentConfig } from "@opencode-ai/sdk";

export type AgentMode = "primary" | "subagent" | "all";

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
  category: "builtin" | "user";
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
  template?: AgentTemplateName;
  createdAt?: number;
  evolvedAt?: number;
  evolutionLog?: EvolutionEntry[];
}

export interface EvolutionEntry {
  timestamp: number;
  trigger: string;
  observation: string;
  directive: string;
  rolledBack: boolean;
}

export type AgentTemplateName = "general" | "coder" | "reviewer" | "researcher" | "coordinator" | "architect" | "debugger" | "tester" | "documenter" | "optimizer";

export interface AgentTemplate {
  name: AgentTemplateName;
  label: string;
  description: string;
  defaultMode: AgentMode;
  defaultSkills: string[];
  promptFn: (name: string, customPrompt?: string) => string;
}

export interface TeamDefinition {
  name: string;
  description: string;
  members: TeamMember[];
  coordination: "parallel" | "sequential" | "adaptive";
  sharedMemory?: string[];
  createdAt?: number;
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

export interface HeraPaths {
  configRoot: string;
  dataDir: string;
  memoryDir: string;
  skillsDir: string;
  agentsDir: string;
}

export interface PluginContext {
  store: import("./memory/store.js").MemoryStore;
  skillManager: import("./skills/manager.js").SkillManager;
  teamManager: import("./team/manager.js").TeamManager;
  distillation: import("./distillation/engine.js").DistillationEngine;
  agentRegistry: import("./agents/registry.js").AgentRegistry;
  registeredAgents: Map<string, AgentDefinition>;
  client: any;
  config: HeraConfig;
  paths: HeraPaths;
}
