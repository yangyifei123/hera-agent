# Hera 技术报告：从零理解 Agent 工厂

> 写给第一次接触 OpenCode 插件和 Agent 的人。不需要任何前置知识。

---

## 第一章：什么是 OpenCode？

想象你有一个超级聪明的 AI 助手住在你的终端（命令行）里。你打字跟它说话，它能帮你写代码、找 bug、读文件、运行命令。这个助手就是 **OpenCode**。

OpenCode 本质上是一个**聊天界面**，但它连接了一个大语言模型（比如 Claude、GPT）。你在终端里打字，AI 回复，还能使用工具（读文件、写文件、运行命令等）。

## 第二章：什么是 Agent（智能体）？

Agent 就是"一个有特定身份的 AI 对话者"。

打个比方：OpenCode 是一家公司，Agent 是公司里的员工。

- **默认员工**（general）：什么都能干，但没有专长
- **code-reviewer**：专门审代码的员工
- **researcher**：专门调研技术的员工

每个 Agent 有：
1. **名字**（code-reviewer）
2. **工作职责描述**（system prompt，告诉 AI 它是谁、该怎么做事）
3. **权限**（能不能编辑文件、能不能运行命令）
4. **模式**：
   - `primary`：你可以直接跟他对话的主管
   - `subagent`：只能被其他 Agent 调用的专员

## 第三章：OpenCode 是怎么发现 Agent 的？

这是最关键的第一性原理。

### 原理：配置文件 + 文件扫描

OpenCode 启动时，会去**几个固定的地方**找 Agent 定义：

```
优先级从高到低：
1. 内置 Agent（OpenCode 自带的 plan、build 等）
2. 插件注册的 Agent（通过 config hook 注入）
3. ~/.claude/agents/*.md（全局用户 Agent）
4. ~/.config/opencode/agents/**/*.md（全局 OpenCode Agent）  ← Hera 用这个！
5. 项目目录/.opencode/agents/*.md（项目级 Agent）
6. opencode.json 里的 agent 字段
```

### Markdown Agent 文件格式

一个 Agent 就是一个 `.md` 文件，长这样：

```markdown
---
name: my-reviewer
description: 专门审查代码的 AI 员工
mode: subagent
model: cherry/GLM-5
---

你是一个代码审查专家。
你的任务是找出代码中的 bug、安全漏洞和性能问题。
```

上面 `---` 之间的部分叫 **YAML frontmatter**（元数据），下面是 **system prompt**（工作说明书）。

**所以，让 Agent 出现在 OpenCode 中的核心就是：把正确格式的 .md 文件放到正确的目录里。**

## 第四章：什么是 OpenCode 插件（Plugin）？

### 第一性原理：插件就是一个 JavaScript 函数

OpenCode 插件系统基于一个简单的约定：

```javascript
// 一个插件就是一个函数
async function MyPlugin(input, options) {
  // input 包含：API 客户端、项目信息、目录路径等
  // 这个函数返回一组"钩子"(hooks)
  return {
    config: async function(config) { /* 修改配置 */ },
    tool: { /* 注册自定义工具 */ },
    // ... 其他钩子
  };
}
```

就这么简单。**插件 = 一个函数 + 返回钩子。**

### 钩子（Hooks）是什么？

钩子是插件介入 OpenCode 工作流程的切入点。想象你在快递公司工作：

| 钩子 | 比喻 | 作用 |
|------|------|------|
| `config` | 上班前看通知板 | 在 OpenCode 启动时修改配置，比如注册新 Agent |
| `tool` | 提供新工具 | 给 Agent 提供新的工具（就像给员工发新的工具箱） |
| `chat.message` | 监听电话 | 收到消息时做处理 |
| `experimental.chat.system.transform` | 在员工的工位上贴便签 | 修改 Agent 的系统提示词 |
| `experimental.session.compacting` | 下班前整理笔记 | 对话被压缩时插入上下文 |

### 插件怎么安装？

1. 把插件包放到 `~/.config/opencode/node_modules/` 目录
2. 在 `~/.config/opencode/opencode.json` 里写上插件名：

```json
{
  "plugin": ["hera-agent"]
}
```

3. OpenCode 启动时自动加载

卸载？反过来操作：从 json 里删掉名字，删掉 node_modules 里的包。

## 第五章：Hera 是什么？

### 核心概念：Agent 工厂

如果 OpenCode 是一家公司，普通插件是雇佣固定员工的招聘公司，那 **Hera 就是一个能创造员工的造人工厂**。

```
普通插件：我有 10 个固定员工，选一个用吧
Hera：告诉我你需要什么样的员工，我现场给你造一个
```

### Hera 的能力

| 能力 | 通俗解释 |
|------|---------|
| 创建 Agent | 你说"我要一个会查安全漏洞的员工"，Hera 就造一个 |
| 创建 Skill | 你说"记住这个工作技巧"，Hera 就把它存下来 |
| Skill 升级为 Agent | 一个技巧积累够了，就升级成独立员工 |
| 创建 Team | 把几个员工编成一队，一起干活 |
| 蒸馏会话 | 聊完天后，把学到的东西提炼成知识 |
| 持久化记忆 | 所有造过的员工和学到的知识，重启后还在 |

## 第六章：Hera 是怎么工作的？（技术细节）

### 6.1 整体架构

```
你跟 Hera 说话
       ↓
Hera 调用自己的工具（hera_create_agent 等）
       ↓
工具做了两件事：
  ① 把 Agent 写成 .md 文件 → 放到 ~/.config/opencode/agents/hera/ 目录
  ② 立即把 Agent 注册到当前会话的 config 中
       ↓
结果：
  - 当前会话：Agent 立刻可用
  - 重启后：OpenCode 扫描目录，自动发现 Agent
```

### 6.2 Agent 创建流程（最核心的部分）

```
步骤 1：你告诉 Hera "创建一个叫 sentinel 的安全审查 Agent"

步骤 2：Hera 调用 hera_create_agent 工具，传入参数：
        - name: "sentinel"
        - description: "安全审查"
        - prompt: "你是安全审查专家..."
        - mode: "subagent"

步骤 3：工具执行，做三件事：

  ① 生成 markdown 文件内容：
     ---
     name: sentinel
     description: 安全审查
     mode: subagent
     ---
     你是安全审查专家...
     （自动追加 caveman skill 内容）

  ② 写入磁盘：
     ~/.config/opencode/agents/hera/sentinel.md

  ③ 注入内存：
     registeredAgents.set("sentinel", {...})

步骤 4：config hook 把 sentinel 注入到 OpenCode 的 agent 注册表
        → 你可以立刻用 @sentinel 调用

步骤 5：下次重启 OpenCode
        → OpenCode 扫描 agents/hera/ 目录
        → 自动发现 sentinel.md
        → sentinel 出现在 opencode list agent 中
```

### 6.3 代码结构（每个文件做了什么）

```
src/
├── index.ts              ← 入口。初始化所有子系统，返回钩子
│
├── agents/
│   ├── hera.ts           ← 定义 Hera 自己是谁（system prompt）
│   └── registry.ts       ← 核心！把 Agent 写成 .md 文件到磁盘
│
├── memory/
│   └── store.ts          ← 持久化存储（JSON 文件系统）
│
├── skills/
│   ├── caveman.ts        ← 内置的"压缩语言"skill
│   └── manager.ts        ← 管理 skill 的创建、删除、升级
│
├── distillation/
│   └── engine.ts         ← 从对话中提炼知识
│
├── team/
│   └── manager.ts        ← 团队管理，用 OpenCode session API 创建真实会话
│
├── tools/
│   └── hera-tools.ts     ← 14 个自定义工具（hera_create_agent 等）
│
└── types.ts              ← 所有类型定义
```

### 6.4 config hook 的关键作用

这是 Hera 最精妙的部分。OpenCode 的 `config` 钩子在**每次启动时**都会被调用。Hera 在这个钩子里做了这件事：

```javascript
async config(input) {
  // 1. 扫描 ~/.config/opencode/agents/hera/ 目录下的所有 .md 文件
  // 2. 解析每个文件，得到 AgentDefinition
  // 3. 把每个 agent 注入到 input.agent 对象中

  input.agent["hera"] = heraAgentConfig;
  input.agent["sentinel"] = sentinelAgentConfig;
  input.agent["architect"] = architectAgentConfig;
  // ... 所有已创建的 agent
}
```

这样，**只要文件在磁盘上，Agent 就会永远被注册**。不需要手动编辑配置文件。

### 6.5 Team 怎么工作

Team 不是假的。Hera 使用 OpenCode 的 **Session API** 创建真实的子会话：

```
hera_spawn_team("security-squad", "审查这段代码")

  → 团队协调模式是 parallel（并行）
  → 成员: sentinel, security-lead

执行过程：
  1. 调用 client.session.create() 创建两个子会话
     - 子会话 1: parentID=当前会话, agent=sentinel
     - 子会话 2: parentID=当前会话, agent=security-lead

  2. 调用 client.session.promptAsync() 发送任务
     - 给 sentinel 发: "审查这段代码"
     - 给 security-lead 发: "审查这段代码"

  3. 如果是 sequential 模式，会等第一个完成再启动第二个
     如果是 parallel 模式，两个同时运行

  4. 收集结果返回
```

每个团队成员都是**独立的 OpenCode 会话**，可以独立使用工具、读文件、写代码。不是模拟的。

### 6.6 Caveman Skill 是什么

Caveman（穴居人模式）是一个内置的沟通风格 skill。它的作用是让 AI 用**极度简洁**的语言回复，省掉 75% 的 token。

```
普通回复:
"Sure! I'd be happy to help you with that. The issue you're experiencing
is likely caused by the fact that your authentication middleware is not
properly validating the token expiration."

Caveman 回复:
"Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"
```

支持 6 个强度等级：lite、full、ultra、wenyan-lite、wenyan-full、wenyan-ultra。

## 第七章：从安装到使用——完整流程

### 第一步：理解目录结构

```
~/.config/opencode/
├── opencode.json          ← OpenCode 的主配置文件
├── package.json           ← npm 依赖（插件在这里声明）
├── node_modules/          ← 插件包
│   ├── hera-agent/        ← Hera 插件
│   │   └── dist/index.js  ← 插件入口
│   ├── @opencode-ai/      ← OpenCode 插件 SDK
│   └── ...
├── agents/                ← Agent 定义文件目录
│   ├── 00-general/        ← 用户自己放的 agent
│   ├── hera/              ← Hera 创建的 agent（自动生成）
│   │   ├── sentinel.md
│   │   └── architect.md
│   └── ...
└── hera-data/             ← Hera 的私有数据
    ├── memory/            ← 记忆存储
    │   ├── agents/
    │   ├── skills/
    │   └── ...
    └── skills/            ← Skill 文件
```

### 第二步：安装

```bash
# 进入 OpenCode 配置目录
cd ~/.config/opencode

# 安装 Hera 包（假设已发布到 npm，或用本地路径）
bun add hera-agent
# 或者: bun add /path/to/hera-agent

# 编辑 opencode.json，添加 "hera-agent" 到 plugin 列表
# {
#   "plugin": ["hera-agent"]
# }
```

### 第三步：启动

```bash
opencode --agent hera
```

### 第四步：使用

```
你: 创建一个叫 code-guard 的 agent，专门检查代码质量

Hera: [调用 hera_create_agent 工具]
      → 写入 ~/.config/opencode/agents/hera/code-guard.md
      → 注册到当前会话
      → code-guard 已创建，现在就可以用 @code-guard 调用

你: 把 code-guard 加上 code-reviewer 组成一个审查团队

Hera: [调用 hera_create_team 工具]
      → 创建 team，成员: code-guard + code-reviewer

你: 启动团队，审查 src/auth.ts

Hera: [调用 hera_spawn_team 工具]
      → 创建两个 OpenCode 子会话
      → code-guard 和 code-reviewer 同时审查文件
      → 返回合并结果
```

### 第五步：重启后

```bash
opencode list agent
# 输出:
# hera           - Hera — Agent Factory
# code-guard     - 代码质量检查 Agent    ← 还在！
# sentinel       - 安全审查 Agent         ← 还在！

opencode --agent code-guard
# 直接启动 code-guard 对话
```

## 第八章：自测试结果

我们对 Hera 进行了 88 项自动化测试，覆盖：

| 测试阶段 | 项数 | 结果 |
|---------|------|------|
| 插件加载 & 钩子验证 | 6 | ✓ |
| 工具注册 | 15 | ✓ |
| Agent 创建 & 磁盘持久化 | 9 | ✓ |
| 多 Agent 创建 | 3 | ✓ |
| Agent 列表 | 4 | ✓ |
| Skill 系统 | 5 | ✓ |
| Skill → Agent 升级 | 4 | ✓ |
| 内置 Skill 保护 | 2 | ✓ |
| Team 创建 & 校验 | 6 | ✓ |
| Team 消息 | 3 | ✓ |
| Memory 系统 | 4 | ✓ |
| 会话蒸馏 | 3 | ✓ |
| config hook 注入 | 10 | ✓ |
| Agent 删除 | 5 | ✓ |
| system prompt 注入 | 2 | ✓ |
| 重启模拟 | 8 | ✓ |
| 边界情况 | 2 | ✓ |
| **总计** | **88** | **88/88 ✓** |

## 第九章：总结——三句话记住 Hera

1. **Agent = 一个 .md 文件**：OpenCode 通过扫描目录来发现 Agent，所以创建 Agent 就是写文件
2. **插件 = 一个函数**：OpenCode 插件就是一个返回钩子的 JavaScript 函数，`config` 钩子用来注册 Agent
3. **Hera = 自动化这个过程**：你用自然语言描述需求，Hera 自动写文件、注册 Agent、组织团队

---

*报告完成。如需更多技术细节，请参阅 [README.md](./README.md) 和 [源代码](./src/)。*
