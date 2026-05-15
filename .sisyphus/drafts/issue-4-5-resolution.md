# Draft: Issue #4 and Issue #5 Resolution Plan

## Issue #4: Install is Too Complex

### Requirements (confirmed)
- 安装流程需要区分 Windows 和 Linux
- hera-agent 安装后缺少 node_modules, package.json, dist/index.js
- PowerShell 路径问题需要通过 cmd /c 绕过
- 安装前需要 npm install 完成依赖安装

### Technical Decisions
- Issue 是安装文档 + postinstall 脚本的问题
- 当 postinstall.mjs 运行时，可能未正确处理 Windows 路径
- bin/hera.js 的安装说明过于简陋，需要重写

### Scope Boundaries
- INCLUDE: 修复安装流程、跨平台兼容、文档更新
- EXCLUDE: 核心架构变更（属于 Issue #5）

## Issue #5: Functional Error — Core Concept Misalignment

### Requirements (confirmed)
1. Skill → Agent/Team 升级需要先分析拆解 skill
2. 生成的 agent 应该是代码形式（插件），不是 .md 文件
3. Skill 可能包含多个脚本/参考文件/串联关系
4. Team 需要结构化管理方法（OKR、树状、控制系统）

### Technical Decisions
- 这是一个重大架构变更，涉及 Hera 的核心概念
- 当前 Hera 生成 .md agent（OpenCode 内置格式）
- 用户想要生成代码插件（可以独立安装/卸载）
- 需要 v3.0 级别的重新设计

### Scope Boundaries
- INCLUDE: 架构重新设计、skill 分析拆解、代码插件生成、团队管理方法
- EXCLUDE: Issue #4 的安装流程修复

## Open Questions
- Issue #5 是否意味着完全放弃 .md agent 格式？
- 用户期望的"代码插件"是否就是 OpenCode 插件格式？
- OKR/树状/控制系统管理具体指什么？

## Research Status
- Explore agent 1: OpenCode plugin architecture analysis (running - timeout)
- Explore agent 2: Skill system analysis ✅ DONE — **Detailed limitations identified**
- Librarian: Platform-specific installation research ✅ DONE — **Full guide created**

## Research Findings Summary

### From Librarian (Installation Research)
- OpenCode uses `~/.config/opencode/` on all platforms
- Windows path: `$env:USERPROFILE\.config\opencode`
- `opencode plugin` = `bun add` + opencode.json update
- postinstall.mjs 目前只打印消息，无实际动作
- 缺少跨平台路径处理

### From Explore (Skill System Analysis)
**核心局限**:
1. Skills 是单一 `prompt` 字符串 blob
2. 无 `dependencies`, `files`, `references` 字段
3. `upgradeSkillsToAgentPrompt()` 只是字符串拼接
4. `SKILL.md` 文件写入后从未读取
5. `trigger` 是描述文本，非可执行条件
6. 无链式触发/事件系统

**v3.0 需要的改变**:
- SkillPackage 类型（多文件支持）
- 依赖/链式图模型
- SkillAnalyzer 分解引擎
- 统一存储策略
