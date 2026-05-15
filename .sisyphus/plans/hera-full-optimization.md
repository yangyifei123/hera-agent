# Hera-Agent Full Optimization Plan

## TL;DR

> **Quick Summary**: 全面优化 Hera-Agent 的核心功能（记忆、进化、蒸馏、团队、持久化）和用户体验（错误消息、向导、CLI、引导），同时清理技术债务。TDD 工作流，分5波并行执行。
> 
> **Deliverables**:
> - bun:test 测试框架 + 全量测试覆盖
> - src/constants.ts 常量提取
> - tools/index.ts 拆分为6个域文件
> - src/helpers.ts 共享逻辑提取
> - 智能记忆系统（自动从会话提取）
> - 半自动进化系统（读取 auto_evolve 配置）
> - 语义蒸馏引擎（真实消息 + 多语言）
> - hera_quick_team 一键成团工具
> - 统一持久化层（单一 persistAgent 方法）
> - PluginContext 接口隔离
> - 可操作的错误消息
> - hera_quickstart 引导向导
> - 功能性 CLI
> - 首次运行引导
> - Agent 名称验证
> - 软删除 + 备份
> - 搜索/过滤增强
> - OpenCode client 类型定义
> - 调试日志系统
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: T1(constants) → T3(helpers) → T5(persist) → T8(distill) → T13(memory) → T14(evolution) → T16(quick-team) → F1-F4

---

## Context

### Original Request
用户要求对 Hera-Agent 提出优化建议，主要关注核心功能和用户体验。经讨论，决定将全部15项优化整合为完整工作计划。

### Interview Summary
**Key Discussions**:
- 测试策略：用户选择 TDD 工作流 + bun:test 框架设置
- 向后兼容：Agent mode 重命名仅文档说明，不改代码（保留 primary/subagent/all）
- 范围确认：排除 CI/CD、linting、新模板；包含全部核心功能 + UX + 技术债

**Research Findings**:
- 15 TypeScript 文件，~2200 行代码，6 个模块
- 23 工具在单一 524 行文件中
- agents/hera.ts 硬编码导入 4 个 skill 文件，添加 builtin 需改两处
- MemoryStore 是纯 JSON I/O，无锁/无事务
- client 类型为 `any`，无编译时安全
- distillSession() 接收 dummy 消息而非真实会话内容
- auto_evolve 配置字段存在但从未被代码读取

### Metis Review
**Identified Gaps** (addressed):
- 工具实际数量为 23 个（非原始文档中的 17+）
- bun:test 是 Bun 内置的，无需安装额外依赖
- buildAgentPrompt() 跳过 skill-combo，需在拆分时保持此行为
- 团队消息队列仅内存中存在，需考虑持久化
- 重构期间需保持 OpenCode 插件 API 兼容性

---

## Work Objectives

### Core Objective
全面优化 Hera-Agent 的核心功能、用户体验和技术债务，使 agent 工厂从"能用"升级为"好用"。

### Concrete Deliverables
- 20+ 个新增/修改的源文件
- 全量测试覆盖（bun:test）
- 所有 23 工具功能增强
- CLI 从信息打印升级为实际管理工具

### Definition of Done
- [ ] `bun test` 全部通过
- [ ] `bun run build` 成功输出 dist/
- [ ] 所有 15 项优化有对应测试
- [ ] AGENTS.md 更新反映新架构

### Must Have
- TDD 工作流：每个任务先写测试再实现
- bun:test 框架配置完整
- 所有现有功能不退化
- 23 工具全部保留且向后兼容

### Must NOT Have (Guardrails)
- 不改变 OpenCode 插件 API 接口（hooks 签名不变）
- 不添加新的运行时依赖（仅用 bun:test，已是 Bun 内置）
- 不修改 hera.json schema 的必填字段
- 不删除任何现有工具（只增强，不破坏）
- 不将 mode 重命名引入代码（仅文档）
- 不添加需要网络请求的功能（保持零网络依赖）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (setting up new)
- **Automated tests**: YES (TDD)
- **Framework**: bun:test (Bun built-in)
- **TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Module/Library**: Use Bash (bun test) — run tests, assert pass/fail
- **CLI**: Use Bash — run hera commands, validate output
- **Plugin hooks**: Use Bash (bun test) — mock OpenCode client, verify hook behavior

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — TDD infra + constants + helpers):
├── T1: Setup bun:test + constants.ts [quick]
├── T2: Extract shared helpers (default skills, permissions) [quick]
├── T3: Type OpenCode client interface [quick]
├── T4: Add debug logging utility [quick]
├── T5: Unify persistence layer (persistAgent) [unspecified-high]
└── T6: Interface segregation for PluginContext [quick]

Wave 2 (Core refactor — split monolith + fix coupling):
├── T7: Split tools/index.ts into 6 domain files [unspecified-high]
├── T8: Fix DistillationEngine — real messages + multilingual [deep]
├── T9: Wire auto_evolve config reading [quick]
├── T10: Agent name validation [quick]
├── T11: Improve error messages with suggestions [quick]
└── T12: Add search/filter enhancements to list/recall [unspecified-high]

Wave 3 (Smart features — memory + evolution + team):
├── T13: Implement auto-memory from session compacting [deep]
├── T14: Implement semi-automatic evolution (auto_evolve=true) [deep]
├── T15: Add hera_quick_team tool with templates [unspecified-high]
├── T16: Add hera_quickstart guided wizard [unspecified-high]
└── T17: Soft delete + backup for agents [quick]

Wave 4 (CLI + onboarding — user-facing):
├── T18: Make CLI functional (hera list agents, status, verify) [unspecified-high]
├── T19: First-run onboarding experience [unspecified-high]
├── T20: Update documentation (AGENTS.md, CLAUDE.md, mode naming) [writing]
└── T21: Final integration tests + build verification [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 → T2 → T5 → T8 → T13 → T14 → T15 → T21 → F1-F4
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Wave 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| T1 | - | T2,T3,T4,T5,T6,T7 | 1 |
| T2 | T1 | T5,T7,T8 | 1 |
| T3 | T1 | T7 | 1 |
| T4 | T1 | T7,T9 | 1 |
| T5 | T1,T2 | T7,T8,T13,T15,T17 | 1 |
| T6 | T1 | T7 | 1 |
| T7 | T1,T2,T3,T4,T5,T6 | T8-T19 | 2 |
| T8 | T5,T7 | T13,T20 | 2 |
| T9 | T4,T7 | T14 | 2 |
| T10 | T7 | T15,T16 | 2 |
| T11 | T7 | T16 | 2 |
| T12 | T7 | T18 | 2 |
| T13 | T5,T7,T8 | T20 | 3 |
| T14 | T7,T9 | T20 | 3 |
| T15 | T7,T10 | T20 | 3 |
| T16 | T7,T10,T11 | T20 | 3 |
| T17 | T5,T7 | T20 | 3 |
| T18 | T7,T12 | T20 | 4 |
| T19 | T7 | T20 | 4 |
| T20 | T8-T19 | T21 | 4 |
| T21 | T20 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: 6 tasks — T1→`quick`, T2→`quick`, T3→`quick`, T4→`quick`, T5→`unspecified-high`, T6→`quick`
- **Wave 2**: 6 tasks — T7→`unspecified-high`, T8→`deep`, T9→`quick`, T10→`quick`, T11→`quick`, T12→`unspecified-high`
- **Wave 3**: 5 tasks — T13→`deep`, T14→`deep`, T15→`unspecified-high`, T16→`unspecified-high`, T17→`quick`
- **Wave 4**: 4 tasks — T18→`unspecified-high`, T19→`unspecified-high`, T20→`writing`, T21→`unspecified-high`
- **FINAL**: 4 tasks — F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs

- [x] 1. Setup bun:test + Extract Constants

  **What to do**:
  - Create `bunfig.toml` with test configuration for bun:test
  - Create `src/constants.ts` extracting all magic numbers:
    - `DEFAULT_HERA_MAX_STEPS = 50`
    - `DEFAULT_CHILD_MAX_STEPS = 30`
    - `TEAM_POLL_MAX_ATTEMPTS = 120`
    - `TEAM_POLL_INTERVAL_MS = 1000`
    - `DEFAULT_MEMORY_LIMIT = 1000`
    - `DEFAULT_TEAM_TIMEOUT_MS = 300000`
    - `DEFAULT_SKILLS = ["caveman", "init", "memory", "evolution"] as const`
    - `DEFAULT_PERMISSION = { edit: "allow", bash: "allow", webfetch: "allow" } as const`
    - `MAX_DISTILL_DECISIONS = 10`, `MAX_DISTILL_PATTERNS = 20`, `MAX_SUMMARY_LENGTH = 200`, `MAX_SKILL_DESC_LENGTH = 100`
    - `MAX_RECALL_RESULTS = 10`, `MAX_RESULT_PREVIEW_LENGTH = 200`
  - Replace all hardcoded values with constants from `src/constants.ts`
  - Write TDD tests first: `src/constants.test.ts` verifying all constants exist and have expected values

  **Must NOT do**:
  - Do not change any runtime behavior — constants must have same values as current hardcoded numbers
  - Do not add external test dependencies

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T2-T6 after constants file exists)
  - **Parallel Group**: Wave 1
  - **Blocks**: T2, T3, T4, T5, T6, T7
  - **Blocked By**: None

  **References**:
  - `src/agents/hera.ts:229,251` — hardcoded maxSteps values
  - `src/tools/index.ts:40` — hardcoded maxSteps: 30
  - `src/team/manager.ts:163,181` — hardcoded polling values
  - `src/index.ts:39,42` — hardcoded memory_limit and timeout
  - `src/distillation/engine.ts:55,78,100,123` — hardcoded slice limits
  - `src/tools/index.ts:265,321` — hardcoded slice limits

  **Acceptance Criteria**:
  - [ ] `src/constants.ts` exists with all named constants
  - [ ] `bun test src/constants.test.ts` → PASS
  - [ ] No hardcoded magic numbers remain in source files (grep verified)

  **QA Scenarios**:
  ```
  Scenario: Constants match original hardcoded values
    Tool: Bash (bun test)
    Steps:
      1. Run `bun test src/constants.test.ts`
      2. Assert all tests pass
    Expected Result: ALL PASS
    Evidence: .sisyphus/evidence/task-1-constants-test.txt

  Scenario: No magic numbers remain in source
    Tool: Bash (grep)
    Steps:
      1. Grep for `maxSteps: 30` and `maxSteps: 50` in src/ (excluding constants.ts and test files)
      2. Grep for `maxAttempts = 120` in src/
      3. Grep for `setTimeout(r, 1000)` in src/
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-1-no-magic-numbers.txt
  ```

  **Commit**: YES
  - Message: `refactor: extract constants and setup bun:test`
  - Files: `src/constants.ts, bunfig.toml, src/**/*.test.ts, src/**/*.(ts)` (replaced references)

---

- [x] 2. Extract Shared Helpers

  **What to do**:
  - Create `src/helpers.ts` with:
    - `getDefaultSkills(additional?: string[]): string[]` — returns `[...DEFAULT_SKILLS, ...additional]` with dedup
    - `getDefaultPermission(): AgentConfig["permission"]` — returns `DEFAULT_PERMISSION`
    - `buildSkillPromptEmbedding(skills: SkillDefinition[]): string` — replaces duplicated skill embedding logic in hera.ts and index.ts
  - Replace 4 occurrences of `["caveman", "init", "memory", "evolution"]` with `getDefaultSkills()`
  - Replace 3 occurrences of permission object with `getDefaultPermission()`
  - Replace duplicated skill prompt building in `index.ts:126-142` with `buildSkillPromptEmbedding()`
  - TDD: `src/helpers.test.ts`

  **Must NOT do**:
  - Do not change skill embedding behavior — output must be identical
  - Do not remove skill-combo from template defaults

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T3-T6)
  - **Parallel Group**: Wave 1
  - **Blocks**: T5, T7
  - **Blocked By**: T1

  **References**:
  - `src/agents/hera.ts:317` — default skills in template creation
  - `src/agents/registry.ts:174` — default skills in markdown parsing fallback
  - `src/tools/index.ts:39` — default skills in tool creation
  - `src/tools/index.ts:178` — default skills in upgrade-to-agent
  - `src/agents/hera.ts:230-234,252-256` — permission object duplication
  - `src/agents/registry.ts:43-47` — permission object duplication
  - `src/index.ts:126-142` — skill prompt embedding (duplicated with hera.ts:buildAgentPrompt)

  **Acceptance Criteria**:
  - [ ] `src/helpers.ts` exists with 3 exported functions
  - [ ] `bun test src/helpers.test.ts` → PASS
  - [ ] No inline `["caveman", "init", "memory", "evolution"]` arrays remain (except in constants.ts)

  **QA Scenarios**:
  ```
  Scenario: Helper functions produce identical output
    Tool: Bash (bun test)
    Steps:
      1. Run `bun test src/helpers.test.ts`
      2. Assert getDefaultSkills() returns same array
      3. Assert getDefaultPermission() returns same object
      4. Assert buildSkillPromptEmbedding() produces same markdown
    Expected Result: ALL PASS
    Evidence: .sisyphus/evidence/task-2-helpers-test.txt
  ```

  **Commit**: YES
  - Message: `refactor: extract shared helpers`
  - Files: `src/helpers.ts, src/helpers.test.ts, src/**/*.ts` (replaced usages)

---

- [x] 3. Type OpenCode Client Interface

  **What to do**:
  - Create `src/types/client.ts` defining `OpenCodeClient` interface:
    ```typescript
    export interface OpenCodeClient {
      session: {
        create(args: { body: { parentID: string; title: string }; query: { directory: string } }): Promise<{ data: { id: string } | string }>;
        promptAsync(args: { path: { id: string }; body: { agent: string; parts: Array<{ type: string; text: string }> } }): Promise<void>;
        status(args: { path: { id: string } }): Promise<{ data: { status: string } }>;
        messages(args: { path: { id: string } }): Promise<{ data: Array<{ role: string; parts?: Array<{ text?: string }> }> }>;
      };
    }
    ```
  - Replace `client: any` in `types.ts:128` and `team/manager.ts:27` with `OpenCodeClient`
  - Remove `as any` casts in tools/index.ts where client is used
  - TDD: `src/types/client.test.ts` verifying interface structure

  **Must NOT do**:
  - Do not add runtime validation — this is compile-time only
  - Do not break existing client calls — interface must match actual API

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T2, T4-T6)
  - **Parallel Group**: Wave 1
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/types.ts:128` — `client: any`
  - `src/team/manager.ts:27` — `private client: any`
  - `src/tools/index.ts:101,105-113` — client usage in hera_spawn_agent
  - `src/team/manager.ts:147-155` — client usage in spawnMemberSession

  **Acceptance Criteria**:
  - [ ] `src/types/client.ts` exists with OpenCodeClient interface
  - [ ] No `client: any` remains in types.ts or team/manager.ts
  - [ ] `bun run build` succeeds with typed client

  **QA Scenarios**:
  ```
  Scenario: Build succeeds with typed client
    Tool: Bash
    Steps:
      1. Run `bun run build`
      2. Assert no TypeScript errors
    Expected Result: "build done"
    Evidence: .sisyphus/evidence/task-3-typed-client-build.txt
  ```

  **Commit**: YES
  - Message: `refactor: type OpenCode client interface`
  - Files: `src/types/client.ts, src/types.ts, src/team/manager.ts, src/tools/index.ts`

---

- [x] 4. Add Debug Logging Utility

  **What to do**:
  - Create `src/logger.ts` with:
    - `heraLog(level: 'debug'|'info'|'warn', message: string, data?: unknown): void`
    - Reads `HERA_LOG_LEVEL` env var (default: 'warn')
    - `debug` level only logs when HERA_LOG_LEVEL=debug
    - `info` level logs when HERA_LOG_LEVEL=info or debug
    - `warn` always logs
  - Replace `console.log` in `src/index.ts:46` with `heraLog('info', ...)`
  - Replace `console.warn` in `src/index.ts:48` with `heraLog('warn', ...)`
  - Add `heraLog('debug', ...)` to all silent catch blocks (8+ locations)
  - TDD: `src/logger.test.ts`

  **Must NOT do**:
  - Do not add external logging library
  - Do not change default behavior — warn still logs, info/debug silent by default

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T2, T3, T5, T6)
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T9
  - **Blocked By**: T1

  **References**:
  - `src/index.ts:46,48` — console.log/warn
  - `src/agents/registry.ts:57-60,122-125,131-134` — silent catch blocks
  - `src/memory/store.ts:30-32,55-57,66-68` — silent catch blocks

  **Acceptance Criteria**:
  - [ ] `src/logger.ts` exists
  - [ ] `bun test src/logger.test.ts` → PASS
  - [ ] No `console.log` or `console.warn` in production code (excluding logger.ts)

  **QA Scenarios**:
  ```
  Scenario: Logger respects HERA_LOG_LEVEL env
    Tool: Bash
    Steps:
      1. Set HERA_LOG_LEVEL=debug, run test
      2. Set HERA_LOG_LEVEL=warn (default), run test
      3. Assert debug messages only appear in debug mode
    Expected Result: Correct filtering per level
    Evidence: .sisyphus/evidence/task-4-logger-test.txt
  ```

  **Commit**: YES
  - Message: `feat: add debug logging utility`
  - Files: `src/logger.ts, src/logger.test.ts, src/**/*.ts` (replaced console.*)

---

- [x] 5. Unify Persistence Layer

  **What to do**:
  - Create `src/persistence.ts` with:
    - `persistAgent(def: AgentDefinition, skills: Map<string, SkillDefinition>): Promise<{config, fileWritten, memoryId}>` — single method that:
      1. Calls `agentRegistry.register(def, skills)` to write .md
      2. Calls `store.save()` to write MemoryStore JSON
      3. Updates `registeredAgents` Map
      4. Returns all results
    - `removeAgent(name: string): Promise<boolean>` — single method that:
      1. Removes from `registeredAgents` Map
      2. Calls `agentRegistry.unregister(name)`
      3. Calls `store.delete()`
  - Replace 3 separate calls in `hera_create_agent`, `hera_delete_agent`, `hera_upgrade_to_agent`, `hera_import_agent` with single method calls
  - TDD: `src/persistence.test.ts` with mocked registry and store

  **Must NOT do**:
  - Do not change the .md file format or MemoryStore JSON structure
  - Do not remove the backup MemoryStore write — it's needed for recovery

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T3, T4, T6)
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T8, T13, T15, T17
  - **Blocked By**: T1, T2

  **References**:
  - `src/tools/index.ts:45-54` — hera_create_agent: 3 separate persistence calls
  - `src/tools/index.ts:86-90` — hera_delete_agent: 3 separate calls
  - `src/tools/index.ts:183-193` — hera_upgrade_to_agent: 3 separate calls
  - `src/tools/index.ts:478-489` — hera_import_agent: 3 separate calls

  **Acceptance Criteria**:
  - [ ] `src/persistence.ts` exists with persistAgent() and removeAgent()
  - [ ] `bun test src/persistence.test.ts` → PASS
  - [ ] No direct `store.save()` + `agentRegistry.register()` pairs in tools (replaced by persistAgent)

  **QA Scenarios**:
  ```
  Scenario: persistAgent writes both .md and MemoryStore
    Tool: Bash (bun test)
    Steps:
      1. Mock AgentRegistry and MemoryStore
      2. Call persistAgent with test agent definition
      3. Assert register() was called (writes .md)
      4. Assert save() was called (writes JSON)
      5. Assert registeredAgents Map updated
    Expected Result: All 3 persistence targets written
    Evidence: .sisyphus/evidence/task-5-persist-test.txt
  ```

  **Commit**: YES
  - Message: `refactor: unify persistence layer`
  - Files: `src/persistence.ts, src/persistence.test.ts, src/tools/index.ts`

---

- [x] 6. Interface Segregation for PluginContext

  **What to do**:
  - Define domain-specific context interfaces in `src/types.ts`:
    ```typescript
    export interface AgentToolCtx { agentRegistry: AgentRegistry; registeredAgents: Map<string, AgentDefinition>; store: MemoryStore; skillManager: SkillManager; config: HeraConfig; }
    export interface SkillToolCtx { skillManager: SkillManager; store: MemoryStore; config: HeraConfig; }
    export interface TeamToolCtx { teamManager: TeamManager; store: MemoryStore; registeredAgents: Map<string, AgentDefinition>; client: OpenCodeClient; config: HeraConfig; }
    export interface MemoryToolCtx { store: MemoryStore; config: HeraConfig; }
    export interface EvolutionToolCtx { agentRegistry: AgentRegistry; registeredAgents: Map<string, AgentDefinition>; store: MemoryStore; }
    export interface SystemToolCtx { store: MemoryStore; skillManager: SkillManager; teamManager: TeamManager; agentRegistry: AgentRegistry; registeredAgents: Map<string, AgentDefinition>; config: HeraConfig; }
    ```
  - Update each tool group to receive only its specific context
  - Keep `PluginContext` as the union for backward compat, but tools use narrower types
  - TDD: verify each tool group only accesses its declared dependencies

  **Must NOT do**:
  - Do not break the PluginContext type — it's used in index.ts
  - Do not change tool signatures — only internal typing

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T2-T5)
  - **Parallel Group**: Wave 1
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/types.ts:121-131` — PluginContext definition
  - `src/tools/index.ts:10` — destructuring all modules from ctx

  **Acceptance Criteria**:
  - [ ] Domain-specific context interfaces defined
  - [ ] `bun run build` succeeds
  - [ ] Each tool group uses only its declared dependencies

  **QA Scenarios**:
  ```
  Scenario: Build succeeds with segregated contexts
    Tool: Bash
    Steps:
      1. Run `bun run build`
      2. Assert no TypeScript errors
    Expected Result: "build done"
    Evidence: .sisyphus/evidence/task-6-segregation-build.txt
  ```

  **Commit**: YES
  - Message: `refactor: interface segregation for PluginContext`
  - Files: `src/types.ts, src/tools/index.ts`

---

- [x] 7. Split Tools Monolith into Domain Files

  **What to do**:
  - Split `src/tools/index.ts` (524 lines) into:
    - `src/tools/agent-tools.ts` — hera_create_agent, hera_list_agents, hera_delete_agent, hera_spawn_agent, hera_verify_agent, hera_export_agent, hera_import_agent
    - `src/tools/skill-tools.ts` — hera_create_skill, hera_list_skills, hera_delete_skill, hera_upgrade_to_agent
    - `src/tools/team-tools.ts` — hera_create_team, hera_list_teams, hera_delete_team, hera_spawn_team, hera_team_message
    - `src/tools/memory-tools.ts` — hera_remember, hera_recall
    - `src/tools/evolution-tools.ts` — hera_evolve_agent, hera_list_evolutions, hera_rollback_evolution, hera_distill_session
    - `src/tools/system-tools.ts` — hera_status
  - `src/tools/index.ts` becomes barrel: imports and merges all domain files
  - Each file receives only its domain-specific context (from T6)
  - Use `persistAgent()`/`removeAgent()` from T5 instead of direct calls
  - TDD: each domain file gets its own test

  **Must NOT do**:
  - Do not change any tool names, descriptions, or behavior
  - Do not remove the barrel export — other code imports from tools/index.ts
  - Do not break buildAgentPrompt's skill-combo skip behavior

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all Wave 1)
  - **Parallel Group**: Wave 2 (first task)
  - **Blocks**: T8-T19
  - **Blocked By**: T1, T2, T3, T4, T5, T6

  **References**:
  - `src/tools/index.ts` — entire 524-line file to split
  - `src/persistence.ts` — use persistAgent/removeAgent
  - `src/types.ts` — domain-specific context interfaces

  **Acceptance Criteria**:
  - [ ] 6 domain tool files exist, each <100 lines
  - [ ] `src/tools/index.ts` is barrel export only
  - [ ] `bun test` → ALL PASS
  - [ ] `bun run build` succeeds
  - [ ] All 23 tools still registered and functional

  **QA Scenarios**:
  ```
  Scenario: All 23 tools still registered after split
    Tool: Bash (bun test)
    Steps:
      1. Run test that imports createAllTools
      2. Assert returned object has 23 keys
      3. Assert each key matches expected tool name
    Expected Result: 23 tools, all names match
    Evidence: .sisyphus/evidence/task-7-tools-split.txt

  Scenario: Build succeeds after split
    Tool: Bash
    Steps:
      1. Run `bun run build`
    Expected Result: "build done"
    Evidence: .sisyphus/evidence/task-7-tools-build.txt
  ```

  **Commit**: YES
  - Message: `refactor: split tools monolith into domain files`
  - Files: `src/tools/*.ts`

---

- [x] 8. Fix DistillationEngine — Real Messages + Multilingual

  **What to do**:
  - Modify `hera_distill_session` tool to fetch real session messages via `client.session.messages()` instead of passing dummy `[system: "Session distillation requested"]`
  - Add Chinese pattern extraction to `extractPatterns()`:
    - `React/Vue/Angular` → also match `前端/组件/响应式`
    - `Docker/Kubernetes` → also match `容器/编排/部署`
    - `SQL/NoSQL` → also match `数据库/查询/索引`
    - `auth/JWT/OAuth` → also match `认证/鉴权/令牌`
    - `testing/TDD` → also match `测试/单元测试/集成测试`
  - Add `extractArchitecturalDecisions()` method — detect "使用X架构"、"选择Y方案" patterns
  - Increase extraction limits using constants from T1
  - TDD: `src/distillation/engine.test.ts` with Chinese and English test cases

  **Must NOT do**:
  - Do not remove English pattern support
  - Do not change DistillationResult type shape
  - Do not require network access — if client.session.messages fails, fall back to provided messages

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T9-T12)
  - **Parallel Group**: Wave 2
  - **Blocks**: T13, T20
  - **Blocked By**: T5, T7

  **References**:
  - `src/distillation/engine.ts` — entire file (140 lines)
  - `src/tools/evolution-tools.ts` (after T7) — hera_distill_session tool definition
  - `src/distillation/engine.ts:103-123` — extractPatterns() with hardcoded English regex

  **Acceptance Criteria**:
  - [ ] `bun test src/distillation/engine.test.ts` → PASS (including Chinese patterns)
  - [ ] Chinese tech terms extracted correctly
  - [ ] Falls back gracefully when client.session.messages unavailable

  **QA Scenarios**:
  ```
  Scenario: Chinese patterns extracted
    Tool: Bash (bun test)
    Steps:
      1. Test with "使用React组件库进行前端开发"
      2. Assert "React" and "前端" in extracted patterns
    Expected Result: Both Chinese and English terms extracted
    Evidence: .sisyphus/evidence/task-8-chinese-patterns.txt

  Scenario: Graceful fallback when client unavailable
    Tool: Bash (bun test)
    Steps:
      1. Mock client.session.messages to throw
      2. Call distillSession with fallback messages
      3. Assert result still produced (not error)
    Expected Result: Distillation succeeds with provided messages
    Evidence: .sisyphus/evidence/task-8-fallback.txt
  ```

  **Commit**: YES
  - Message: `feat: semantic distillation engine with multilingual support`
  - Files: `src/distillation/engine.ts, src/distillation/engine.test.ts, src/tools/evolution-tools.ts`

---

- [x] 9. Wire auto_evolve Config Reading

  **What to do**:
  - In `src/index.ts`, read `config.auto_evolve` and pass to PluginContext
  - Add `auto_evolve` flag to PluginContext (or relevant context interface)
  - In `experimental.session.compacting` hook, if `auto_evolve === true`, add prompt: "Reflect on this session's failures and propose evolution directives if needed"
  - This enables agents to self-propose evolutions — user still confirms via hera_evolve_agent
  - TDD: test that compacting hook includes evolution prompt when auto_evolve=true

  **Must NOT do**:
  - Do not auto-apply evolutions without user confirmation
  - Do not change hera.json schema

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T8, T10-T12)
  - **Parallel Group**: Wave 2
  - **Blocks**: T14
  - **Blocked By**: T4, T7

  **References**:
  - `src/index.ts:180-182` — experimental.session.compacting hook
  - `src/types.ts:90` — auto_evolve field in HeraConfig (exists but unused)

  **Acceptance Criteria**:
  - [ ] `config.auto_evolve` is read and passed to hooks
  - [ ] Compacting hook includes evolution prompt when auto_evolve=true
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: auto_evolve=true adds evolution prompt
    Tool: Bash (bun test)
    Steps:
      1. Set config.auto_evolve = true
      2. Trigger compacting hook
      3. Assert output.context includes evolution reflection prompt
    Expected Result: Evolution prompt present
    Evidence: .sisyphus/evidence/task-9-auto-evolve.txt
  ```

  **Commit**: YES
  - Message: `feat: wire auto_evolve config for evolution prompts`
  - Files: `src/index.ts, src/types.ts`

---

- [x] 10. Agent Name Validation

  **What to do**:
  - Create `src/validation.ts` with `validateAgentName(name: string): { valid: boolean; error?: string; suggestion?: string }`:
    - Must be lowercase + hyphens only (regex: `/^[a-z][a-z0-9-]*$/`)
    - No spaces, special chars, or starting with hyphen/number
    - Reserved names: "hera", "opencode", "system"
    - Max length: 50 chars
    - Suggest normalized name: "My Agent" → "my-agent"
  - Add validation to `hera_create_agent` and `hera_upgrade_to_agent` tools
  - Add conflict check: if agent already exists, suggest hera_delete_agent first
  - TDD: `src/validation.test.ts` with edge cases

  **Must NOT do**:
  - Do not validate existing agent names (backward compat)
  - Do not break agents created before this change

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T8, T9, T11, T12)
  - **Parallel Group**: Wave 2
  - **Blocks**: T15, T16
  - **Blocked By**: T7

  **References**:
  - `src/tools/agent-tools.ts` (after T7) — hera_create_agent definition
  - `src/agents/registry.ts:34` — file path construction (where invalid names would break)

  **Acceptance Criteria**:
  - [ ] `src/validation.ts` exists
  - [ ] `bun test src/validation.test.ts` → PASS
  - [ ] hera_create_agent rejects invalid names with helpful error + suggestion

  **QA Scenarios**:
  ```
  Scenario: Invalid name rejected with suggestion
    Tool: Bash (bun test)
    Steps:
      1. Call validateAgentName("My Agent")
      2. Assert valid=false, suggestion="my-agent"
      3. Call validateAgentName("hera")
      3. Assert valid=false, error contains "reserved"
    Expected Result: Clear rejection with actionable suggestion
    Evidence: .sisyphus/evidence/task-10-validation.txt
  ```

  **Commit**: YES
  - Message: `feat: agent name validation`
  - Files: `src/validation.ts, src/validation.test.ts, src/tools/agent-tools.ts`

---

- [x] 11. Improve Error Messages with Suggestions

  **What to do**:
  - Update all error messages in tools to include actionable suggestions:
    - `hera_spawn_agent`: "Session API not available" → "This feature requires an active OpenCode session. Try running within an OpenCode session."
    - `hera_create_team`: "Unknown agents: X" → "Agents X don't exist yet. Create them first with hera_create_agent, or use hera_quick_team for auto-creation."
    - `hera_delete_skill`: "Built-in skills are protected" → "Built-in skills (caveman, init, skill-combo, memory, evolution) cannot be deleted. Create a custom skill instead."
    - `hera_evolve_agent`: "Agent not found" → "Agent X not found. Use hera_list_agents to see available agents."
    - `hera_team_message`: "not a member" → "X is not in team Y. Current members: [list]. Use hera_create_team to update members."
  - Add `suggestion` field pattern to error returns
  - TDD: test each error message contains suggestion

  **Must NOT do**:
  - Do not change tool return types (strings remain strings)
  - Do not auto-execute suggested actions — only suggest

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T8-T10, T12)
  - **Parallel Group**: Wave 2
  - **Blocks**: T16
  - **Blocked By**: T7

  **References**:
  - `src/tools/agent-tools.ts` (after T7) — spawn_agent error at line ~102
  - `src/tools/team-tools.ts` (after T7) — create_team error at line ~213
  - `src/tools/skill-tools.ts` (after T7) — delete_skill error at line ~157

  **Acceptance Criteria**:
  - [ ] All error messages include actionable next step
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: Error messages contain suggestions
    Tool: Bash (bun test)
    Steps:
      1. Trigger each error condition
      2. Assert response contains "try" or "use" or "create" suggestion
    Expected Result: Every error is actionable
    Evidence: .sisyphus/evidence/task-11-error-suggestions.txt
  ```

  **Commit**: YES
  - Message: `feat: actionable error messages with suggestions`
  - Files: `src/tools/*.ts`

---

- [x] 12. Search/Filter Enhancements for List/Recall

  **What to do**:
  - Add filter parameters to `hera_list_agents`:
    - `mode?: AgentMode` — filter by mode
    - `template?: string` — filter by template
    - `skill?: string` — filter by skill
  - Enhance `hera_recall` search:
    - Add `limit?: number` parameter (default 10, max 50)
    - Add `since?: number` timestamp filter
    - Improve search: add word-boundary matching (not just substring)
  - Enhance `MemoryStore.search()`:
    - Add optional `since` timestamp parameter
    - Add word-boundary matching alongside substring
  - TDD: test filtering and enhanced search

  **Must NOT do**:
  - Do not break existing hera_list_agents or hera_recall calls (new params are optional)
  - Do not add external search library

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T8-T11)
  - **Parallel Group**: Wave 2
  - **Blocks**: T18
  - **Blocked By**: T7

  **References**:
  - `src/tools/agent-tools.ts` (after T7) — hera_list_agents
  - `src/tools/memory-tools.ts` (after T7) — hera_recall
  - `src/memory/store.ts:71-78` — search method

  **Acceptance Criteria**:
  - [ ] hera_list_agents accepts filter params
  - [ ] hera_recall accepts limit and since params
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: Filter agents by mode
    Tool: Bash (bun test)
    Steps:
      1. Create agents with different modes
      2. Call hera_list_agents with mode="subagent"
      3. Assert only subagent agents returned
    Expected Result: Correct filtering
    Evidence: .sisyphus/evidence/task-12-filter-test.txt
  ```

  **Commit**: YES
  - Message: `feat: search and filter enhancements`
  - Files: `src/tools/agent-tools.ts, src/tools/memory-tools.ts, src/memory/store.ts`

---

- [x] 13. Implement Auto-Memory from Session Compacting

  **What to do**:
  - Create `src/memory/smart-extractor.ts` with `extractMemories(messages): HeraMemory[]`:
    - Detect decision phrases: "decided to", "chose", "will use", "选择", "决定使用"
    - Detect fix patterns: "fixed", "resolved", "bug was", "修复了", "解决了"
    - Detect pattern phrases: "always use", "never do", "必须", "绝不"
    - Auto-categorize: decisions → "decision", fixes → "fix", patterns → "pattern"
  - Modify `experimental.session.compacting` hook in index.ts:
    - Call `smartExtractor.extractMemories()` on session messages
    - Auto-save extracted memories via `store.save()`
    - Add `auto_memory: true` config option (default: false)
  - TDD: `src/memory/smart-extractor.test.ts` with Chinese + English cases

  **Must NOT do**:
  - Do not auto-save if `auto_memory` is false or undefined
  - Do not save more than 5 memories per compaction event
  - Do not duplicate existing memories (check content similarity)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T14-T17)
  - **Parallel Group**: Wave 3
  - **Blocks**: T20
  - **Blocked By**: T5, T7, T8

  **References**:
  - `src/index.ts:180-182` — experimental.session.compacting hook
  - `src/distillation/engine.ts:84-100` — existing extractDecisions (reference for patterns)
  - `src/memory/store.ts` — MemoryStore.save()

  **Acceptance Criteria**:
  - [ ] `src/memory/smart-extractor.ts` exists
  - [ ] `bun test src/memory/smart-extractor.test.ts` → PASS
  - [ ] Compacting hook auto-saves when auto_memory=true

  **QA Scenarios**:
  ```
  Scenario: Auto-extract Chinese decisions
    Tool: Bash (bun test)
    Steps:
      1. Pass messages containing "决定使用React进行前端开发"
      2. Assert extracted memory with category="decision"
    Expected Result: Decision extracted and categorized
    Evidence: .sisyphus/evidence/task-13-auto-memory.txt
  ```

  **Commit**: YES
  - Message: `feat: auto-memory from session compacting`
  - Files: `src/memory/smart-extractor.ts, src/memory/smart-extractor.test.ts, src/index.ts`

---

- [x] 14. Implement Semi-Automatic Evolution

  **What to do**:
  - Create `src/evolution/auto-evolve.ts` with `proposeEvolution(failureContext: string): EvolutionEntry | null`:
    - Analyze failure message for common patterns
    - Map to evolution directives: "SQL injection missed" → "Always verify database queries use parameterized statements"
    - Return proposed EvolutionEntry (or null if no pattern matched)
  - Add `hera_propose_evolution` tool (new, non-breaking):
    - Takes `agent_name` + `failure_description`
    - Returns proposed evolution for user review
    - User then calls `hera_evolve_agent` to confirm
  - In `experimental.session.compacting` hook, when `auto_evolve=true`, add prompt suggesting evolution review
  - TDD: `src/evolution/auto-evolve.test.ts`

  **Must NOT do**:
  - Do not auto-apply evolutions — always require explicit hera_evolve_agent call
  - Do not add more than 3 proposed evolutions per session

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T13, T15-T17)
  - **Parallel Group**: Wave 3
  - **Blocks**: T20
  - **Blocked By**: T7, T9

  **References**:
  - `src/types.ts:38-44` — EvolutionEntry type
  - `src/tools/evolution-tools.ts` (after T7) — hera_evolve_agent
  - `src/index.ts:180-182` — compacting hook

  **Acceptance Criteria**:
  - [ ] `src/evolution/auto-evolve.ts` exists
  - [ ] `hera_propose_evolution` tool registered
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: Propose evolution from failure
    Tool: Bash (bun test)
    Steps:
      1. Call proposeEvolution("Failed to detect SQL injection in user input")
      2. Assert returned EvolutionEntry with relevant directive
    Expected Result: Proposed directive about parameterized queries
    Evidence: .sisyphus/evidence/task-14-auto-evolve.txt
  ```

  **Commit**: YES
  - Message: `feat: semi-automatic evolution with proposal system`
  - Files: `src/evolution/auto-evolve.ts, src/evolution/auto-evolve.test.ts, src/tools/evolution-tools.ts`

---

- [x] 15. Add hera_quick_team Tool with Templates

  **What to do**:
  - Create `src/team/templates.ts` with predefined team templates:
    ```typescript
    export const TEAM_TEMPLATES = {
      "code-review": { description: "Code review team", members: [{role: "reviewer", template: "reviewer"}, {role: "bug-hunter", template: "debugger"}], coordination: "parallel" },
      "dev-pipeline": { description: "Dev pipeline", members: [{role: "architect", template: "architect"}, {role: "coder", template: "coder"}, {role: "tester", template: "tester"}], coordination: "sequential" },
      "research": { description: "Research team", members: [{role: "researcher", template: "researcher"}, {role: "writer", template: "documenter"}], coordination: "sequential" },
    }
    ```
  - Add `hera_quick_team` tool:
    - Args: `name, template, task_description?`
    - Auto-creates member agents from template (if not existing)
    - Creates team
    - Optionally spawns team if task_description provided
  - TDD: `src/team/templates.test.ts`

  **Must NOT do**:
  - Do not replace hera_create_team — this is a convenience wrapper
  - Do not auto-spawn without explicit task_description

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T13, T14, T16, T17)
  - **Parallel Group**: Wave 3
  - **Blocks**: T20
  - **Blocked By**: T7, T10

  **References**:
  - `src/tools/team-tools.ts` (after T7) — existing team tools
  - `src/agents/hera.ts:15-158` — AGENT_TEMPLATES
  - `src/team/manager.ts` — TeamManager

  **Acceptance Criteria**:
  - [ ] `src/team/templates.ts` exists with 3+ templates
  - [ ] `hera_quick_team` tool registered and functional
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: Quick team creates all members + team
    Tool: Bash (bun test)
    Steps:
      1. Call hera_quick_team with template="code-review"
      2. Assert 2 agents created (reviewer + debugger)
      3. Assert team created with 2 members
    Expected Result: Team ready in one call
    Evidence: .sisyphus/evidence/task-15-quick-team.txt
  ```

  **Commit**: YES
  - Message: `feat: hera_quick_team with team templates`
  - Files: `src/team/templates.ts, src/team/templates.test.ts, src/tools/team-tools.ts`

---

- [x] 16. Add hera_quickstart Guided Wizard

  **What to do**:
  - Add `hera_quickstart` tool:
    - Args: `purpose: string` (what the agent should do)
    - Logic:
      1. Analyze purpose to suggest template (coding→coder, reviewing→reviewer, etc.)
      2. Suggest mode based on template (reviewer→subagent, coder→all)
      3. Generate name from purpose (slugify)
      4. Create agent with suggested params
      5. Return creation result + usage examples based on mode
    - Usage examples: subagent → "Use @agent-name in your prompt", all → "Use opencode --agent agent-name"
  - TDD: test purpose→template mapping and name generation

  **Must NOT do**:
  - Do not replace hera_create_agent — this is a convenience wrapper
  - Do not force the suggested template — user can override

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T13-T15, T17)
  - **Parallel Group**: Wave 3
  - **Blocks**: T20
  - **Blocked By**: T7, T10, T11

  **References**:
  - `src/tools/agent-tools.ts` (after T7) — hera_create_agent
  - `src/agents/hera.ts:15-158` — AGENT_TEMPLATES for suggestion logic
  - `src/validation.ts` (from T10) — validateAgentName

  **Acceptance Criteria**:
  - [ ] `hera_quickstart` tool registered
  - [ ] Returns agent + usage examples
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: Quickstart suggests correct template
    Tool: Bash (bun test)
    Steps:
      1. Call hera_quickstart with purpose="code review specialist"
      2. Assert suggested template="reviewer"
      3. Assert suggested mode="subagent"
      4. Assert usage example contains "@"
    Expected Result: Correct template + mode + usage hint
    Evidence: .sisyphus/evidence/task-16-quickstart.txt
  ```

  **Commit**: YES
  - Message: `feat: hera_quickstart guided wizard`
  - Files: `src/tools/agent-tools.ts`

---

- [x] 17. Soft Delete + Backup for Agents

  **What to do**:
  - Create `src/persistence.ts:backupAgent()` method (extend from T5):
    - Before deletion, save agent JSON to `hera-data/backups/agent-{name}-{timestamp}.json`
    - Keep last 5 backups per agent (rotate oldest)
  - Add `hera_restore_agent` tool:
    - Args: `name: string, timestamp?: number` (restore specific backup or latest)
    - Lists available backups if no timestamp specified
    - Restores agent from backup JSON
  - Modify `removeAgent()` to call `backupAgent()` first
  - TDD: test backup creation, rotation, and restore

  **Must NOT do**:
  - Do not auto-restore — user must explicitly call hera_restore_agent
  - Do not keep more than 5 backups per agent

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T13-T16)
  - **Parallel Group**: Wave 3
  - **Blocks**: T20
  - **Blocked By**: T5, T7

  **References**:
  - `src/persistence.ts` (from T5) — removeAgent method
  - `src/tools/agent-tools.ts` (after T7) — hera_delete_agent

  **Acceptance Criteria**:
  - [ ] `hera_restore_agent` tool registered
  - [ ] Deletion creates backup before removing
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: Delete creates backup, restore works
    Tool: Bash (bun test)
    Steps:
      1. Create agent "test-backup"
      2. Delete agent "test-backup"
      3. Assert backup file exists in hera-data/backups/
      4. Call hera_restore_agent("test-backup")
      5. Assert agent restored and functional
    Expected Result: Full backup/restore cycle works
    Evidence: .sisyphus/evidence/task-17-backup-restore.txt
  ```

  **Commit**: YES
  - Message: `feat: soft delete with backup and restore`
  - Files: `src/persistence.ts, src/tools/agent-tools.ts`

---

- [x] 18. Make CLI Functional

  **What to do**:
  - Rewrite `bin/hera.js` to actually perform operations:
    - `hera list agents` — read `~/.config/opencode/agents/hera/*.md`, parse frontmatter, display table
    - `hera list teams` — read `~/.config/opencode/hera-data/memory/teams/*.json`, display
    - `hera list skills` — read `~/.config/opencode/hera-data/skills/*/SKILL.md`, display
    - `hera status` — count agents, skills, teams, memory entries, check hera.json validity
    - `hera verify` — check installation: opencode.json has plugin, dist/ exists, agents dir exists
    - `hera config` — display current hera.json
  - Keep existing commands (version, install, update, uninstall, help)
  - Convert to TypeScript: `bin/hera.ts` with `bun run` shebang

  **Must NOT do**:
  - Do not require OpenCode runtime — CLI works standalone by reading files directly
  - Do not add write operations to CLI yet (read-only CLI is safer)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T19)
  - **Parallel Group**: Wave 4
  - **Blocks**: T20
  - **Blocked By**: T7, T12

  **References**:
  - `bin/hera.js` — current CLI (128 lines, plain JS)
  - `~/.config/opencode/agents/hera/*.md` — agent files to read
  - `~/.config/opencode/hera-data/` — data directory to read

  **Acceptance Criteria**:
  - [ ] `hera list agents` shows agent table
  - [ ] `hera status` shows system health
  - [ ] `hera verify` checks installation
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: CLI lists agents
    Tool: Bash
    Steps:
      1. Run `node bin/hera.js list agents`
      2. Assert output contains agent names and modes
    Expected Result: Agent table displayed
    Evidence: .sisyphus/evidence/task-18-cli-list.txt

  Scenario: CLI verify checks installation
    Tool: Bash
    Steps:
      1. Run `node bin/hera.js verify`
      2. Assert output shows installation status
    Expected Result: Installation verified
    Evidence: .sisyphus/evidence/task-18-cli-verify.txt
  ```

  **Commit**: YES
  - Message: `feat: functional CLI with list, status, verify`
  - Files: `bin/hera.js, bin/hera.ts`

---

- [x] 19. First-Run Onboarding Experience

  **What to do**:
  - Add `onboarding_complete: boolean` to hera.json default config
  - In `config` hook, if `onboarding_complete === false`:
    - Inject onboarding prompt: "Welcome to Hera! I've created a demo coder agent for you. Try: @demo-coder write a hello world function"
    - Auto-create a demo agent: `demo-coder` from coder template
  - After first `hera_create_agent` call, set `onboarding_complete: true` in hera.json
  - TDD: test onboarding prompt injection and demo agent creation

  **Must NOT do**:
  - Do not auto-create more than 1 demo agent
  - Do not block normal operation if onboarding fails

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T18)
  - **Parallel Group**: Wave 4
  - **Blocks**: T20
  - **Blocked By**: T7

  **References**:
  - `src/index.ts:113-153` — config hook (injection point)
  - `src/index.ts:28-49` — hera.json auto-creation (add onboarding_complete field)

  **Acceptance Criteria**:
  - [ ] Onboarding prompt injected on first run
  - [ ] Demo agent auto-created
  - [ ] `onboarding_complete` set to true after first agent creation
  - [ ] `bun test` → PASS

  **QA Scenarios**:
  ```
  Scenario: First run shows onboarding
    Tool: Bash (bun test)
    Steps:
      1. Set hera.json onboarding_complete=false
      2. Trigger config hook
      3. Assert onboarding prompt in system output
      4. Assert demo-coder agent exists
    Expected Result: Onboarding experience triggered
    Evidence: .sisyphus/evidence/task-19-onboarding.txt
  ```

  **Commit**: YES
  - Message: `feat: first-run onboarding experience`
  - Files: `src/index.ts, src/types.ts`

---

- [x] 20. Update Documentation

  **What to do**:
  - Update `AGENTS.md` to reflect new architecture (split tools, new files, constants, helpers)
  - Update `CLAUDE.md` with:
    - New file structure (tools/*.ts, constants.ts, helpers.ts, etc.)
    - Agent mode naming guidance (recommend standalone/assistant/flexible in docs, note primary/subagent/all still work)
    - New tools: hera_quick_team, hera_quickstart, hera_propose_evolution, hera_restore_agent
    - auto_memory and auto_evolve config options
  - Update `README.md` with:
    - New tool descriptions
    - Team templates section
    - Onboarding mention
    - CLI commands (hera list agents, hera status, hera verify)
  - Update `hera.schema.json` with new config fields (auto_memory, onboarding_complete)

  **Must NOT do**:
  - Do not remove existing documentation
  - Do not add marketing language — keep technical and precise

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: [`writing-clearly-and-concisely`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs all prior tasks complete)
  - **Parallel Group**: Wave 4 (last before integration)
  - **Blocks**: T21
  - **Blocked By**: T8-T19

  **References**:
  - `AGENTS.md` — current knowledge base
  - `CLAUDE.md` — developer documentation
  - `README.md` — user documentation
  - `hera.schema.json` — config schema

  **Acceptance Criteria**:
  - [ ] AGENTS.md reflects new file structure
  - [ ] CLAUDE.md mentions new tools and config options
  - [ ] README.md has new tool descriptions
  - [ ] hera.schema.json has auto_memory and onboarding_complete

  **QA Scenarios**:
  ```
  Scenario: Documentation mentions all new tools
    Tool: Bash (grep)
    Steps:
      1. Grep README.md for "hera_quick_team"
      2. Grep README.md for "hera_quickstart"
      3. Grep README.md for "hera_propose_evolution"
      4. Grep README.md for "hera_restore_agent"
    Expected Result: All 4 new tools documented
    Evidence: .sisyphus/evidence/task-20-docs.txt
  ```

  **Commit**: YES
  - Message: `docs: update documentation for new features and architecture`
  - Files: `AGENTS.md, CLAUDE.md, README.md, hera.schema.json`

---

- [x] 21. Final Integration Tests + Build Verification

  **What to do**:
  - Create `tests/integration.test.ts`:
    - Test full plugin lifecycle: init → create agent → list agents → evolve → delete
    - Test team lifecycle: quick_team → spawn → message
    - Test memory lifecycle: remember → recall → filter
    - Test onboarding: first run → demo agent → create agent → onboarding complete
  - Run `bun run build` and verify dist/ output
  - Run `bun test` and verify all tests pass
  - Verify no TypeScript errors: `bunx tsc --noEmit`

  **Must NOT do**:
  - Do not skip any test category
  - Do not ignore failing tests

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`Code`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs all prior tasks)
  - **Parallel Group**: Wave 4 (final)
  - **Blocks**: F1-F4
  - **Blocked By**: T20

  **References**:
  - All source files — integration test covers full system
  - `package.json` — build and test scripts

  **Acceptance Criteria**:
  - [ ] `bun test` → ALL PASS
  - [ ] `bun run build` → "build done"
  - [ ] Integration tests cover all 23+ tools

  **QA Scenarios**:
  ```
  Scenario: Full integration test suite passes
    Tool: Bash
    Steps:
      1. Run `bun test`
      2. Run `bun run build`
    Expected Result: All tests pass, build succeeds
    Evidence: .sisyphus/evidence/task-21-integration.txt
  ```

  **Commit**: YES
  - Message: `test: final integration tests and build verification`
  - Files: `tests/integration.test.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run build` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **T1**: `refactor: extract constants and setup bun:test` - src/constants.ts, bunfig.toml, src/**/*.test.ts
- **T2**: `refactor: extract shared helpers` - src/helpers.ts
- **T3**: `refactor: type OpenCode client interface` - src/types/client.ts, src/types.ts
- **T4**: `feat: add debug logging utility` - src/logger.ts
- **T5**: `refactor: unify persistence layer` - src/persistence.ts
- **T6**: `refactor: interface segregation for PluginContext` - src/types.ts, src/tools/*.ts
- **T7**: `refactor: split tools monolith into domain files` - src/tools/*.ts
- **T8**: `feat: semantic distillation engine` - src/distillation/engine.ts
- **T9**: `feat: wire auto_evolve config` - src/index.ts
- **T10**: `feat: agent name validation` - src/tools/agent-tools.ts
- **T11**: `feat: actionable error messages` - src/tools/*.ts
- **T12**: `feat: search and filter enhancements` - src/tools/*.ts, src/memory/store.ts
- **T13**: `feat: auto-memory from session compacting` - src/index.ts, src/memory/smart-extractor.ts
- **T14**: `feat: semi-automatic evolution` - src/evolution/auto-evolve.ts
- **T15**: `feat: hera_quick_team with templates` - src/tools/team-tools.ts
- **T16**: `feat: hera_quickstart guided wizard` - src/tools/agent-tools.ts
- **T17**: `feat: soft delete with backup` - src/tools/agent-tools.ts, src/persistence.ts
- **T18**: `feat: functional CLI` - bin/hera.js
- **T19**: `feat: first-run onboarding` - src/index.ts
- **T20**: `docs: update documentation for new features` - AGENTS.md, CLAUDE.md, README.md
- **T21**: `test: final integration tests and build verification` - tests/

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: ALL PASS (50+ tests)
bun run build               # Expected: build done (no errors)
bun run --agent hera        # Expected: plugin loads, hera_status works
```

### Final Checklist
- [x] All "Must Have" present (TDD, bun:test, 23 tools preserved, no regressions)
- [x] All "Must NOT Have" absent (no API changes, no new deps, no mode rename in code)
- [x] All tests pass
- [x] AGENTS.md updated to reflect new architecture
