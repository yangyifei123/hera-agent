# Hera-Agent v3.0 — Issue #5 Architecture Redesign Plan

## TL;DR

> **Quick Summary**: 将 Hera 从".md agent 工厂"升级为"代码插件生成器"，支持 skill 分析拆解、多文件 skill 包、代码级 agent 插件、结构化团队管理。
> 
> **Deliverables**:
> - SkillPackage 系统（多文件 skill 包）
> - SkillAnalyzer 引擎（分析/拆解/冲突检测）
> - 代码插件生成器（生成 OpenCode 插件）
> - 结构化团队管理（OKR/树状/控制系统）
> 
> **Estimated Effort**: XL (~4-5 周)
> **Parallel Execution**: YES - 4 phases

---

## Context

### Original Request (GitHub Issue #5)
用户要求 Hera 的核心功能重新设计：
1. Skill → Agent/Team 升级需要先分析拆解 skill
2. 生成的 agent 应该是代码形式（插件），不是 .md 文件
3. Skill 可能包含多个脚本/参考文件/串联关系
4. Team 需要结构化管理方法（OKR、树状、控制系统）

### Current Architecture (v2.x)
- Agent: `.md` 文件（YAML frontmatter + prompt）
- Skill: 单一 JSON（name + description + trigger + prompt）
- Team: 简单列表（名称 + 成员 + 协调模式）
- Upgrade: 字符串拼接（skill prompt → agent prompt）

### Target Architecture (v3.0)
- Agent: OpenCode 插件（代码包，可安装/卸载）
- Skill: 多文件包（scripts + configs + references + 依赖关系）
- Team: 结构化管理（OKR/树状/控制系统）
- Upgrade: 智能分析（skill 拆解 → 能力映射 → 代码生成）

---

## TODOs

### Phase 1: SkillPackage 系统

- [x] 1.1 设计 SkillPackage 类型定义
  
  **What to do**:
  - 修改 `src/types.ts`，添加新类型：
    ```typescript
    interface SkillPackage {
      name: string;
      version: string;
      description: string;
      trigger: SkillTrigger;
      dependencies: SkillRef[];
      chains: SkillChain[];
      files: SkillFile[];
      config: Record<string, any>;
      scripts: SkillScript[];
      prompt: string;
      metadata: SkillMetadata;
    }
    
    interface SkillTrigger {
      patterns: string[];
      keywords: string[];
      toolCalls?: string[];
    }
    
    interface SkillChain {
      next: string;
      condition: string;
      transform?: string;
    }
    
    interface SkillFile {
      path: string;
      type: "script" | "config" | "reference" | "template";
      content: string;
    }
    
    interface SkillScript {
      name: string;
      runtime: "bun" | "node" | "bash" | "python";
      entry: string;
      args?: string[];
    }
    
    interface SkillMetadata {
      author?: string;
      tags?: string[];
      license?: string;
      compatibility?: string[];
    }
    ```
  - 保留向后兼容：旧的 `SkillDefinition` 仍然可用
  - 添加 `SkillPackage` 到 `HeraMemory` 类型

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 1.2)
  - **Parallel Group**: Phase 1

- [x] 1.2 重构 SkillManager 支持多文件 skill
  
  **What to do**:
  - 修改 `src/skills/manager.ts`：
    - `createSkill()` 改为接受 `SkillPackage`，创建目录结构：
      ```
      ~/.config/opencode/hera-data/skills/
      ├── my-skill/
      │   ├── SKILL.json      # 元数据
      │   ├── SKILL.md        # 核心提示词
      │   ├── config.json     # 运行时配置
      │   ├── scripts/        # 可执行脚本
      │   ├── templates/      # 模板文件
      │   └── references/     # 参考文档
      ```
    - `loadSkill()` 从目录读取所有文件
    - `deleteSkill()` 删除整个目录
    - 添加 `getSkillPackage(name)` 返回完整 SkillPackage
    - 添加 `listSkillPackages()` 列出所有 skill 包
  - 修改 `src/tools/skill-tools.ts`：
    - `hera_create_skill` 支持多文件输入
    - `hera_list_skills` 显示 skill 包结构

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 1.1)
  - **Parallel Group**: Phase 1

### Phase 2: SkillAnalyzer 引擎

- [x] 2.1 创建 SkillAnalyzer 模块
  
  **What to do**:
  - 新建 `src/analyzer/skill-analyzer.ts`：
    - `analyze(skill: SkillPackage): AnalysisResult`
      - 识别 skill 的能力（capabilities）
      - 识别依赖关系
      - 识别冲突（与其他 skill 重叠）
      - 评估复杂度
    - `decompose(skill: SkillPackage): SkillPackage[]`
      - 将复合 skill 拆解为原子 skill
      - 每个原子 skill 只负责单一能力
    - `detectConflicts(skills: SkillPackage[]): ConflictReport`
      - 检测 skill 之间的冲突
      - 生成冲突解决建议
  - 新建 `src/analyzer/capability-mapper.ts`：
    - `mapToAgentCapabilities(skills: SkillPackage[]): AgentCapability[]`
      - 将 skill 能力映射到 agent 能力
      - 确定 agent 需要的工具集
      - 确定 agent 模式（primary/subagent/all）

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Depends On**: Phase 1

- [x] 2.2 升级 hera_upgrade_to_agent 工具
  
  **What to do**:
  - 修改 `src/tools/skill-tools.ts`：
    - `hera_upgrade_to_agent` 改为：
      1. 调用 `SkillAnalyzer.analyze()` 分析 skill
      2. 调用 `SkillDecomposer.decompose()` 拆解 skill
      3. 调用 `CapabilityMapper.mapToAgentCapabilities()` 映射能力
      4. 生成 AgentDefinition（包含能力映射结果）
      5. 调用 `AgentGenerator.generate()` 生成代码插件
    - 添加 `hera_analyze_skill` 工具：只分析不升级
    - 添加 `hera_decompose_skill` 工具：拆解 skill

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Depends On**: 2.1

### Phase 3: 代码插件生成器

- [x] 3.1 创建 PluginGenerator 模块
  
  **What to do**:
  - 新建 `src/generators/plugin-generator.ts`：
    - `generate(agentDef: AgentDefinition, capabilities: AgentCapability[]): PluginPackage`
      - 生成 OpenCode 插件代码：
        ```
        ~/.config/opencode/agents/hera-generated/
        ├── my-agent/
        │   ├── package.json
        │   ├── agent.md
        │   ├── src/
        │   │   └── index.ts
        │   ├── skills/
        │   │   └── ... (包含的 skills)
        │   └── config/
        │       └── defaults.json
        ```
      - `package.json` 包含插件元数据
      - `src/index.ts` 导出 Plugin 函数
      - `agent.md` 包含 agent 元数据（YAML frontmatter）
      - `skills/` 包含引用的 skill 文件
      - `config/defaults.json` 包含默认配置
    - `install(pluginPath: string)` — 安装插件到 OpenCode
    - `uninstall(pluginName: string)` — 卸载插件
  - 新建 `src/generators/templates/`：
    - `plugin-index.ts.tpl` — 插件入口模板
    - `package.json.tpl` — package.json 模板
    - `agent.md.tpl` — agent.md 模板

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Depends On**: Phase 2

- [x] 3.2 添加 hera_install_agent / hera_uninstall_agent 工具
  
  **What to do**:
  - 修改 `src/tools/agent-tools.ts`：
    - 添加 `hera_install_agent`：
      - 参数: `agent_name: string`
      - 调用 `PluginGenerator.install()`
      - 更新 opencode.json plugin 数组
    - 添加 `hera_uninstall_agent`：
      - 参数: `agent_name: string`
      - 调用 `PluginGenerator.uninstall()`
      - 从 opencode.json 移除
    - 修改 `hera_create_agent`：
      - 生成代码插件（而非 .md 文件）
      - 可选参数: `format: "plugin" | "md"`（向后兼容）

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Depends On**: 3.1

### Phase 4: 结构化团队管理

- [x] 4.1 设计 TeamManagement 类型
  
  **What to do**:
  - 修改 `src/types.ts`，扩展 TeamDefinition：
    ```typescript
    interface TeamDefinition {
      name: string;
      description: string;
      coordination: "parallel" | "sequential" | "adaptive";
      management: "simple" | "okr" | "tree" | "control";
      members: TeamMember[];
      
      // OKR 模式
      objectives?: OKRObjective[];
      
      // 树状模式
      hierarchy?: TreeNode[];
      
      // 控制系统模式
      controlPoints?: ControlPoint[];
      
      sharedMemory?: string[];
      createdAt?: number;
    }
    
    interface OKRObjective {
      name: string;
      keyResults: KeyResult[];
      assignee: string;
      deadline?: number;
    }
    
    interface KeyResult {
      description: string;
      target: number;
      current: number;
      metric: string;
    }
    
    interface TreeNode {
      agent: string;
      role: "root" | "manager" | "worker";
      children?: TreeNode[];
      delegates?: string[];
    }
    
    interface ControlPoint {
      name: string;
      type: "checkpoint" | "gate" | "feedback";
      condition: string;
      action: "approve" | "reject" | "escalate";
      reviewer?: string;
    }
    ```

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 4.2)
  - **Parallel Group**: Phase 4

- [x] 4.2 实现 OKR/Tree/Control 管理器
  
  **What to do**:
  - 新建 `src/team/okr-manager.ts`：
    - `createObjective(team: TeamDefinition, objective: OKRObjective)`
    - `updateKeyResult(team: TeamDefinition, objectiveName: string, krIndex: number, progress: number)`
    - `getProgress(team: TeamDefinition): number` — 计算整体进度
  - 新建 `src/team/tree-manager.ts`：
    - `buildHierarchy(members: TeamMember[]): TreeNode[]`
    - `assignTask(tree: TreeNode[], task: string, agent: string)`
    - `getDelegates(node: TreeNode): string[]`
  - 新建 `src/team/control-manager.ts`：
    - `addControlPoint(team: TeamDefinition, point: ControlPoint)`
    - `evaluateControlPoint(team: TeamDefinition, pointName: string, context: any): ControlAction`
    - `escalate(team: TeamDefinition, pointName: string, toAgent: string)`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with 4.1)
  - **Parallel Group**: Phase 4

- [x] 4.3 更新 hera_create_team 工具
  
  **What to do**:
  - 修改 `src/tools/team-tools.ts`：
    - `hera_create_team` 添加 `management` 参数：
      - `"simple"` — 现有行为
      - `"okr"` — 需要 objectives
      - `"tree"` — 需要 hierarchy
      - `"control"` — 需要 controlPoints
    - 添加 `hera_add_objective` 工具
    - 添加 `hera_update_key_result` 工具
    - 添加 `hera_add_control_point` 工具
    - 添加 `hera_get_team_progress` 工具

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Depends On**: 4.1, 4.2

---

## Commit Strategy

- **Phase 1**: `feat: SkillPackage system with multi-file support`
- **Phase 2**: `feat: SkillAnalyzer engine for skill decomposition`
- **Phase 3**: `feat: code plugin generator for OpenCode`
- **Phase 4**: `feat: structured team management (OKR/tree/control)`

---

## Backward Compatibility

- 旧的 `SkillDefinition` 仍然可用（自动转换为 `SkillPackage`）
- 旧的 `.md` agent 仍然可用（可选生成 .md 或插件）
- 旧的 `TeamDefinition` 仍然可用（management 默认为 `"simple"`）
