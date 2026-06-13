/** 共享类型定义，供 mimo-cli / compress / mcp / skills / memory / tools / commands 使用 */

import type OpenAI from 'openai';

/** LLM 消息 */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** OpenAI Function Calling 工具调用（仅助手消息可能有） */
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessage['tool_calls'];
  /** 函数调用结果的 ID（仅 role:'tool' 消息需要） */
  tool_call_id?: string;
}

/** 工具定义 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
  source?: 'builtin' | 'mcp';
}

/** 会话检查点 */
export interface Checkpoint {
  sessionId: string;
  task: string;
  currentFile: string;
  lastAction: string;
  result: string;
  stage: string;
  time: string;
}

/** 历史记录 */
export interface HistoryRecord {
  id?: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  time: string;
}

/** 运行时配置 */
export interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
}
