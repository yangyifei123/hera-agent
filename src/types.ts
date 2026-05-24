import type { AgentConfig } from "@opencode-ai/sdk";
import type { OpenCodeClient } from "./types/client.js";

export type AgentMode = "primary" | "subagent" | "all";

export type WorkflowContext = Record<string, unknown>;

export interface HeraMemory {
  id: string;
  type:
    | "session"
    | "skill"
    | "agent"
    | "team"
    | "distillation"
    | "decision"
    | "fix"
    | "pattern"
    | "preference"
    | "context"
    | "skill-package"
    | "workflow"
    | "team-message"
    | "team-session"
    | "team-memory";
  content: string;
  timestamp: number;
  expiresAt?: number;
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

// v3.0 SkillPackage system
export interface SkillPackage {
  name: string;
  version?: string;
  description: string;
  trigger: string | SkillTrigger;
  category?: "builtin" | "user";
  intensity?: SkillDefinition["intensity"];
  createdAt?: number;
  dependencies?: SkillRef[];
  chains?: SkillChain[];
  files?: SkillFile[];
  config?: Record<string, unknown>;
  scripts?: SkillScript[];
  prompt: string;
  metadata?: SkillMetadata;
}

export interface SkillTrigger {
  patterns: string[];
  keywords: string[];
  toolCalls?: string[];
}

export interface SkillRef {
  name: string;
  version?: string;
  optional?: boolean;
}

export interface SkillChain {
  next: string;
  condition: string;
  transform?: string;
}

export interface SkillFile {
  path: string;
  type?: "script" | "config" | "reference" | "template";
  content: string;
}

export interface SkillScript {
  name: string;
  runtime: "bun" | "node" | "bash" | "python";
  entry: string;
  args?: string[];
}

export interface SkillMetadata {
  author?: string;
  tags?: string[];
  license?: string;
  compatibility?: string[];
}

/** Backward-compatible union: accepts both v1 SkillDefinition and v3.0 SkillPackage */
export type AnySkill = SkillDefinition | SkillPackage;

// v3.0 Team management types
export interface OKRObjective {
  id: string;
  name: string;
  keyResults: KeyResult[];
  assignee?: string;
  deadline?: number;
}

export interface KeyResult {
  id: string;
  description: string;
  target: number;
  current: number;
  metric: string;
}

export interface TreeNode {
  id: string;
  agent: string;
  role: "root" | "manager" | "worker";
  children?: TreeNode[];
  delegates?: string[];
}

export interface ControlPoint {
  id: string;
  name: string;
  type: "checkpoint" | "gate" | "feedback";
  condition: string;
  action: "approve" | "reject" | "escalate";
  reviewer?: string;
  status?: "pending" | "passed" | "failed";
}

export type TeamWorkflowStepType = "agent" | "message" | "approval" | "tool";

export interface TeamWorkflowStep {
  id: string;
  type: TeamWorkflowStepType;
  title: string;
  actor?: string;
  input?: string;
  dependsOn?: string[];
  editable?: boolean;
}

export interface TeamWorkflowStepInput {
  id?: string;
  type: TeamWorkflowStepType;
  title: string;
  actor?: string;
  input?: string;
  dependsOn?: string[];
  editable?: boolean;
}

export interface TeamWorkflowRecipe {
  id: string;
  name: string;
  description?: string;
  mode: "recipe";
  steps: TeamWorkflowStep[];
}

export interface TeamWorkflowRecipeInput {
  id: string;
  name: string;
  description?: string;
  mode: "recipe";
  steps: TeamWorkflowStepInput[];
}

// Workflow system types
export type WorkflowMode = "serial" | "parallel" | "dag";

export interface WorkflowStep {
  id: string;
  name: string;
  type: "agent" | "tool" | "decision" | "approval";
  executor?: string;
  input?: WorkflowContext | string;
  dependencies?: string[];
  condition?: string;
  timeout?: number;
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  mode: WorkflowMode;
  steps: WorkflowStep[];
  createdAt: number;
  metadata?: WorkflowContext;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  currentStep?: string;
  stepResults: Record<string, unknown>;
  context: WorkflowContext;
  startedAt: number;
  completedAt?: number;
  error?: string;
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
  workflow?: WorkflowDefinition;
}

export interface EvolutionEntry {
  timestamp: number;
  trigger: string;
  observation: string;
  directive: string;
  rolledBack: boolean;
}

export type AgentTemplateName =
  | "general"
  | "coder"
  | "reviewer"
  | "researcher"
  | "coordinator"
  | "architect"
  | "debugger"
  | "tester"
  | "documenter"
  | "optimizer";

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
  /** Management mode: simple=flat, okr=objectives/key results, tree=hierarchy, control=approval gates. */
  management?: "simple" | "okr" | "tree" | "control";
  /** Shared workspace entries (blackboard pattern). Members write via hera_team_remember and read via hera_team_recall. */
  sharedMemory?: string[];
  createdAt?: number;
  /** Editable team workflow recipe that users can inspect and modify. */
  workflow?: TeamWorkflowRecipe;
  /** OKR objectives (used when management="okr") */
  objectives?: OKRObjective[];
  /** Tree hierarchy (used when management="tree") */
  hierarchy?: TreeNode[];
  /** Control points (used when management="control") */
  controlPoints?: ControlPoint[];
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
  templates?: Record<string, CustomTemplate>;
  auto_evolve?: boolean;
  auto_memory?: boolean;
  memory_limit?: number;
  memory_ttl_ms?: number;
  team_defaults?: {
    coordination?: "parallel" | "sequential" | "adaptive";
    timeout?: number;
  };
}

export interface CustomTemplate {
  label: string;
  description: string;
  defaultMode: AgentMode;
  defaultSkills?: string[];
  prompt: string;
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
  workflowManager: import("./workflow/manager.js").WorkflowManager;
  distillation: import("./distillation/engine.js").DistillationEngine;
  agentRegistry: import("./agents/registry.js").AgentRegistry;
  registeredAgents: Map<string, AgentDefinition>;
  client: OpenCodeClient | undefined;
  config: HeraConfig;
  paths: HeraPaths;
  autoEvolve: boolean;
}

// --- Interface Segregation: Domain-specific context slices ---

type MemoryStore = import("./memory/store.js").MemoryStore;
type SkillManager = import("./skills/manager.js").SkillManager;
type TeamManager = import("./team/manager.js").TeamManager;
type AgentRegistry = import("./agents/registry.js").AgentRegistry;

export interface AgentToolCtx {
  agentRegistry: AgentRegistry;
  registeredAgents: Map<string, AgentDefinition>;
  store: MemoryStore;
  skillManager: SkillManager;
  config: HeraConfig;
}

export interface SkillToolCtx {
  skillManager: SkillManager;
  store: MemoryStore;
  config: HeraConfig;
}

export interface TeamToolCtx {
  teamManager: TeamManager;
  store: MemoryStore;
  registeredAgents: Map<string, AgentDefinition>;
  client: OpenCodeClient | undefined;
  config: HeraConfig;
}

export interface MemoryToolCtx {
  store: MemoryStore;
  config: HeraConfig;
}

export interface EvolutionToolCtx {
  agentRegistry: AgentRegistry;
  registeredAgents: Map<string, AgentDefinition>;
  store: MemoryStore;
  skillManager: SkillManager;
}

export interface SystemToolCtx {
  store: MemoryStore;
  skillManager: SkillManager;
  teamManager: TeamManager;
  agentRegistry: AgentRegistry;
  registeredAgents: Map<string, AgentDefinition>;
  config: HeraConfig;
}
