#!/usr/bin/env node
/**
 * MiMo Code CLI - 主入口
 * 技术栈: Node.js + TypeScript + Commander + fs + JSON
 * 功能: 终端对话、工具调用、四层记忆、上下文压缩、简易蒸馏
 */

import { Command } from 'commander';
import {
  loadCompressState,
} from './compress';
import type { Message } from './types';
import {
  createBuiltinTools,
  toolRunShell,
} from './tools';
import {
  initMcpTools,
  type SlashContext,
} from './commands';
import { ProviderRouter, type ProviderConfig } from './src/router';
// 启动时自动加载上次激活的 Provider
import { loadProviders } from './commands';
import {
  readCheckpoint,
  initHistory,
  generateSessionId,
} from './memory';
import { mcpMode } from './mcp-mode';
import { appState } from './src/state';
import { loadConfig } from './src/config';

import { runAgent, handleToolCalls } from './src/agent';
import { startCLI } from './src/cli';
import {
  callLLM,
  callLLMSingle,
  handleContextLengthError,
  retryWithBackoff,
  buildSystemPrompt,
  compactContext,
  LLM_TIMEOUT_MS,
  LLM_MAX_RETRIES,
} from './src/llm-core';

// ==================== 全局变量 ====================

let slashCtx: SlashContext;
let router: ProviderRouter | null = null;

// 启动像素标识
// 注意：CJK 字符在终端占 2 列宽，源码只算 1 字符；排版时按 CJK 字符数 -1 计算空格
// 所有行（外框/内框/内容）终端列宽统一为 56
const BANNER = `
╔══════════════════════════════════════════════════════╗
║  ███╗   ███╗     ██████╗ ██████╗ ██████╗ ███████╗    ║
║  ████╗ ████║    ██╔════╝██╔═══██╗██╔══██╗██╔════╝    ║
║  ██╔████╔██║    ██║     ██║   ██║██║  ██║█████╗      ║
║  ██║╚██╔╝██║    ██║     ██║   ██║██║  ██║██╔══╝      ║
║  ██║ ╚═╝ ██║    ╚██████╗╚██████╔╝██████╔╝███████╗    ║
║  ╚═╝     ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝    ║
╠══════════════════════════════════════════════════════╣
║  ▓▒░  ╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮  ░▒▓  ║
║  ▓▒░  ┃ ✦  【 为 发 烧 而 生 】  ✦  mi-cc  ┃  ░▒▓  ║
║  ▓▒░  ┃    智能编程助手 · LLM Agent Shell    ┃  ░▒▓  ║
║  ▓▒░  ╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯  ░▒▓  ║
╚══════════════════════════════════════════════════════╝
`;

// ==================== 初始化 ====================

function initOpenAI(cfg: { apiKey: string; baseUrl: string }) {
  // 延迟导入避免循环依赖
  const OpenAI = require('openai').default;
  return new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
  });
}

// ==================== 主程序 ====================

async function main() {
  const program = new Command();
  program
    .name('mi-cc')
    .description('mi-cc - 智能编程助手 (MCP Server / CLI)')
    .version('1.1.0')
    .option('-s, --session <id>', '指定会话 ID')
    .option('--mcp', '以 MCP Server 模式启动（StdioServerTransport）')
    .parse(process.argv);

  const options = program.opts();

  // MCP Server 模式：提前退出 CLI 流程
  if (options.mcp) {
    await mcpMode();
    return;
  }

  console.log(BANNER);
  console.log('输入 /help 查看可用命令\n');

  const { config, warnings } = loadConfig();
  for (const w of warnings) console.log(`[警告] ${w}`);
  let openai = initOpenAI(config);
  let historyData = initHistory();
  let tools = createBuiltinTools();
  initMcpTools(tools, (cmd, timeout) =>
    toolRunShell({ command: cmd, timeout }),
  );

  // 启动时自动加载上次激活的 Provider（覆盖 .env 中的配置）
  try {
    const providers = loadProviders();
    const active = providers.find((p: any) => p.active);
    if (active) {
      config.apiKey = active.apiKey;
      config.baseUrl = active.baseUrl;
      config.model = active.model;
      openai = initOpenAI(config);
      console.log(`[Provider] 已加载: ${active.name} (${active.model})`);
    }
  } catch {
    // ignore
  }

  // 恢复或创建会话
  const checkpoint = readCheckpoint();
  let currentSessionId: string;
  if (options.session) {
    currentSessionId = options.session;
  } else if (checkpoint && checkpoint.sessionId) {
    currentSessionId = checkpoint.sessionId;
    console.log(`[恢复会话] ${currentSessionId}`);
    console.log(`[上次任务] ${checkpoint.task}`);
  } else {
    currentSessionId = generateSessionId();
    console.log(`[新会话] ${currentSessionId}`);
  }

  // 初始化 appState
  appState.init({
    openai,
    config,
    currentSessionId,
    conversationHistory: [],
    tools,
    historyData,
  });

  // 构建所有 Provider 配置（主 + 备用）
  const allProviders: ProviderConfig[] = [
    {
      id: 'primary',
      name: 'Primary',
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    },
  ];
  const backupProviders = ProviderRouter.loadFromEnv();
  allProviders.push(...backupProviders);

  if (allProviders.length > 1) {
    router = new ProviderRouter(allProviders);
    console.log(`[Provider] 已加载 ${allProviders.length} 个 Provider`);
  }

  // 构建斜杠命令上下文（直接引用 appState）
  slashCtx = {
    openai: appState.get('openai'),
    config: appState.get('config'),
    tools: appState.get('tools'),
  };

  // 恢复压缩摘要层
  const compressState = loadCompressState();
  if (compressState.summaries.length > 0) {
    const summaryMessages: Message[] = compressState.summaries.map((s: any) => ({
      role: 'system' as const,
      content: `[历史摘要 L${s.level} @ ${s.createdAt}]\n${s.text}`,
    }));
    appState.set('conversationHistory', [...summaryMessages, ...appState.get('conversationHistory')]);
    console.log(`[压缩] 已恢复 ${compressState.summaries.length} 层摘要`);
  }

  // 启动 CLI
  await startCLI({
    onUserInput: runAgent,
    slashCtx,
  });
}

main().catch(console.error);

// ==================== 导出（保持向后兼容） ====================

export {
  runAgent,
  handleToolCalls,
  callLLM,
  callLLMSingle,
  handleContextLengthError,
  retryWithBackoff,
  buildSystemPrompt,
  compactContext,
  LLM_TIMEOUT_MS,
  LLM_MAX_RETRIES,
};
