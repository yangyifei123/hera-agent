# Hera-Agent Issue #4 + Issue #5 Resolution Plan

## TL;DR

> **Quick Summary**: 修复安装流程的跨平台兼容问题（Issue #4），并规划 v3.0 架构重新设计（Issue #5）。
> 
> **Deliverables**:
> - 跨平台安装脚本（Windows/Linux 兼容）
> - 功能性 `hera install` 命令
> - `hera doctor` 安装验证
> - 更新文档（区分平台）
> 
> **Estimated Effort**: Small (Issue #4) + XL (Issue #5, separate plan)
> **Parallel Execution**: YES - 4 waves for Issue #4

---

## Context

### Original Request
GitHub Issue #4: 安装太复杂。安装流程没有考虑 Windows/Linux 差异，缺少依赖安装步骤。

### Issue #5 (Deferred)
Issue #5 涉及核心架构重新设计（v3.0），将在 Issue #4 完成后单独规划。

---

## TODOs

- [x] 1. 重写 postinstall.mjs — 跨平台自动配置

  **What to do**:
  - 重写 `postinstall.mjs`：
    - 检测 `process.platform`（win32 vs linux/darwin）
    - 自动创建目录：`hera-data/`, `hera-data/memory/`, `hera-data/skills/`, `agents/hera/`
    - 检查 `opencode.json` 是否包含 `hera-agent`，如果没有则自动添加
    - Windows 下使用 `USERPROFILE` 环境变量
    - 打印安装成功消息，包含平台特定提示
  - 测试：手动运行 `node postinstall.mjs` 确认目录创建和 opencode.json 更新

  **Must NOT do**:
  - 不删除现有配置
  - 不覆盖已有 opencode.json 的其他内容

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1

- [x] 2. 增强 bin/hera.js — 实际执行安装

  **What to do**:
  - 修改 `bin/hera.js` 的 `install` 命令：
    - 实际执行安装逻辑，不只是打印说明
    - 检测 bun/node 是否安装
    - 自动运行 `bun install`（如果 node_modules 缺失）
    - 自动运行 `bun run build`（如果 dist/ 缺失）
    - Windows 下使用 `cmd /c` 绕过 PowerShell 路径限制
    - 添加 `hera doctor` 命令检查安装状态：
      - 检查 opencode.json 是否包含 hera-agent
      - 检查 dist/index.js 是否存在
      - 检查目录结构是否完整
      - 打印平台信息和路径

  **Must NOT do**:
  - 不破坏现有 `help`, `version`, `list`, `update`, `uninstall` 命令

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1

- [x] 3. 更新 README.md — 区分 Windows/Linux 安装指南

  **What to do**:
  - 安装章节拆分为 Windows 和 Linux/macOS 两个独立部分
  - Windows 使用 PowerShell 语法：
    ```powershell
    Set-Location "$env:USERPROFILE\.config\opencode"
    bun add hera-agent
    ```
  - Linux/macOS 使用 bash 语法：
    ```bash
    cd ~/.config/opencode && bun add hera-agent
    ```
  - 添加"故障排除"章节：
    - Windows: PowerShell 路径问题 → 使用 `cmd /c` 解决
    - Linux: 权限问题 → `chmod` 解决
    - 通用: bun 未安装 → 安装指南链接
  - 添加"验证安装"章节

  **Must NOT do**:
  - 不删除现有安装内容

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Depends On**: Task 1, Task 2

- [x] 4. 更新 CLAUDE.md — 添加跨平台注意事项

  **What to do**:
  - 添加"跨平台注意事项"章节：
    - Windows 配置根目录: `%USERPROFILE%\.config\opencode`
    - Linux 配置根目录: `~/.config/opencode`
    - 路径分隔符差异
    - PowerShell vs Bash 命令差异
  - 更新"安装与测试"章节：
    - 添加 `bun install` 步骤
    - 添加 `bun run build` 步骤
    - 添加 `hera doctor` 验证命令

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3)
  - **Depends On**: Task 1, Task 2

---

## Commit Strategy

- **T1+T2**: `fix: cross-platform installation and postinstall automation`
- **T3+T4**: `docs: platform-specific installation guides for Windows and Linux`
