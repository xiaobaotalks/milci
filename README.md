# MiMo Code CLI

最简化版智能编程助手，终端对话 + 工具调用 + 四层记忆 + 分层摘要压缩 + 经验蒸馏 + 技能库。

> 默认对接小米 MiMo（`https://token-plan-cn.xiaomimimo.com/v1`），兼容任意 OpenAI Chat Completions 协议端点。

## 安装

```bash
npm install
```

## 配置

```bash
cp .env.example .env
```

`.env` 内容示例（小米 MiMo）：

```
API_KEY=your_api_key_here
BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MODEL=mimo-v2.5-pro
# MAX_TOKEN 可选；不填则按模型自动推断
#   - MiMo / GPT-4o / Claude / GLM-4 / Moonshot-128k / DeepSeek 全部自动识别
#   - 未知模型默认 8000
```

## 运行

```bash
# 方式一：本地
npm run dev

# 方式二：全局命令
npm link
micli

# 方式三：指定会话
micli -s my-session-id
```

## 斜杠命令

输入 `/` 然后按 **Tab** 可补全命令；只输入 `/` 回车会列出全部命令。

| 命令 | 说明 |
|------|------|
| `/connect <api_key> [base_url] [model]` | 设置 API 配置并写入 `.env` |
| `/compact` | 手动压缩上下文（保留最近 N 轮） |
| `/distill` | 经验蒸馏，把历史挖掘成技能库 |
| `/dream` | 记忆整理 + 清理过期日志 |
| `/skill [list \| <name> \| reload]` | 查看/刷新技能库 |
| `/tools` | 查看所有可用工具 |
| `/help` | 显示帮助 |
| `/exit` / `/quit` | 退出 |

## 功能特性

### 1. 四层记忆系统
| 层级 | 文件 | 用途 |
|------|------|------|
| L1 | `checkpoint.md` | 当前会话检查点，启动自动恢复 |
| L2 | `MEMORY.md` | 跨会话项目记忆，自动注入 System Prompt |
| L3 | `notes.md` | 临时笔记 / 待办 / 调试记录 |
| L4 | `history.json` | 完整对话历史（可检索） |

### 2. 分层摘要压缩（三档触发）
- **软阈值 60%** — 仅日志告警
- **标准阈值 80%** — 早期原文压缩为 L0 摘要，保留最近 5 轮
- **紧急阈值 95%** — 旧摘要与更早原文合并升层，保留最近 3 轮
- 压缩状态持久化到 `compress-state.json`，重启不丢

### 3. 按模型自动识别上下文窗口

内置 13 个主流模型映射（MiMo 1M / GPT-4o 128K / Claude 200K / DeepSeek 64K / GLM-4 128K / Moonshot 128K 等）。启动时若未设置 `MAX_TOKEN` 会自动按模型设置。

> LLM 报错 `context_length_exceeded` / `prompt too long` 时，CLI 会自动降级 `maxTokens`（×0.9）并强制压缩后重试一次。

### 4. 工具调用系统
- **内置工具**：`readFile` / `writeFile` / `runShell` / `git`
- **MCP 风格外部工具**：把 `mcp-tools.json` 或 `mcp-tools/*.json` 放进项目根目录即可自动加载
- **危险命令拦截**：8 条 regex 覆盖 `rm -rf /` / `curl|bash` / `mkfs` / `dd` / fork bomb 等
- **shell 注入防护**：MCP 模板 `{{var}}` 渲染结果自动用单引号包裹转义

### 5. 技能库系统
- `skill-lib.md` 用 Markdown 声明技能
- 输入匹配：CJK 单字 + ASCII 词 + 停用词过滤
- 每次对话 top-2 命中技能自动注入 System Prompt

### 6. 斜杠命令 Tab 补全
- 一级：主命令名
- 二级：子参数（如 `/skill re` 补全为 `/skill reload`）

## 项目结构

```
.
├── mimo-cli.ts         # 主程序入口（Agent 循环、LLM 调用、压缩、checkpoint）
├── commands.ts         # 斜杠命令处理
├── compress.ts         # 分层摘要压缩
├── memory.ts           # 四层记忆读写
├── tools.ts            # 内置工具 + 危险命令拦截
├── skills.ts           # 技能库匹配
├── mcp.ts              # MCP 风格外部工具加载
├── types.ts            # 共享类型
├── bin/micli.js        # CLI 启动器
├── skill-lib.md        # 技能库
├── mcp-tools.example.json
├── .env.example
├── tsconfig.json
└── package.json
```

## 安全说明

- 工具调用结果会作为 `role: 'tool'` 消息传回 LLM（带 `tool_call_id` 配对）
- `runShell` 内部统一走 `child_process.exec` + 危险命令正则拦截
- 写文件自动 `mkdir -p` 父目录
- `.env` 已加入 `.gitignore`，API Key 不会泄露

## 开发

```bash
# 类型检查
npx tsc --noEmit

# 启动开发模式（tsx 自动重载）
npm run dev
```

## License

MIT
