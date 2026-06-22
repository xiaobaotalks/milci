/**
 * Agent - LLM Agent 循环与工具调用
 * 包含 runAgent、handleToolCalls 及相关工具函数
 * LLM 核心函数已移至 llm-core.ts
 */

import {
  toolsToOpenAIFormat,
  executeToolCall,
  extractFileFromArgs,
} from '../tools';
import {
  writeCheckpoint,
  saveHistory,
} from '../memory';
import { appState } from './state';
import OpenAI from 'openai';
import type { Message } from '../types';

import { callLLM, buildSystemPrompt, compactContext } from './llm-core';

// ==================== 常量 ====================

const MAX_TOOL_ITERATIONS = 20;

// ==================== 工具函数 ====================

function formatTimeShort(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 缩进多行输出，保持工具调用框视觉对齐 */
function indentBlock(text: string, prefix: string): string {
  return text.split('\n').map(line => line.length > 0 ? prefix + line : line).join('\n');
}

/** 截断过长结果用于终端预览，保留完整结果到 history */
function previewResult(result: string, maxLen = 400): string {
  if (result.length <= maxLen) return result;
  const head = result.substring(0, maxLen);
  const omitted = result.length - maxLen;
  return `${head}\n... (省略 ${omitted} 字符，完整内容已记录到 history)`;
}

// ==================== 工具调用处理 ====================

export async function handleToolCalls(message: OpenAI.Chat.Completions.ChatCompletionMessage): Promise<string[]> {
  if (!message.tool_calls || message.tool_calls.length === 0) {
    return [];
  }

  const results: string[] = [];
  let lastFile = ''; // 需要从 checkpoint 读取，延迟导入避免循环依赖
  const { readCheckpoint } = await import('../memory');
  const checkpoint = readCheckpoint();
  if (checkpoint) {
    lastFile = checkpoint.currentFile || '';
  }
  const isMulti = message.tool_calls.length > 1;

  for (let idx = 0; idx < message.tool_calls.length; idx++) {
    const toolCall = message.tool_calls[idx];
    const toolName = toolCall.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      results.push(`错误: 工具 ${toolName} 的参数 JSON 解析失败: ${toolCall.function.arguments}`);
      continue;
    }

    // 边框字符：多步调用用 ┌/└ 分隔每步；单步用单行格式
    const top = isMulti ? '┌─' : '──';
    const mid = isMulti ? '├─' : '  ';
    const bot = isMulti ? '└─' : '──';
    const cont = isMulti ? '│' : ' ';

    console.log(`${top} [${formatTimeShort()}] 🔧 ${toolName}(${JSON.stringify(args)})`);

    const t0 = Date.now();
    const result = await executeToolCall(appState.get('tools'), toolName, args);
    const elapsed = Date.now() - t0;
    results.push(result);

    const isError = result.startsWith('错误:') || result.startsWith('命令执行错误:') || result.startsWith('读取失败') || result.startsWith('写入失败');
    const status = isError ? '✗ 失败' : '✓ 成功';
    const lines = result.split('\n').length;
    console.log(`${mid} [${formatTimeShort()}] ${status} (${elapsed}ms, ${result.length} 字符, ${lines} 行)`);
    console.log(`${cont} ${indentBlock(previewResult(result), isMulti ? '│ ' : '  ').trimStart()}`);

    if (isMulti) console.log(bot);

    const file = extractFileFromArgs(toolName, args);
    if (file) lastFile = file;

    writeCheckpoint({
      sessionId: appState.get('currentSessionId'),
      task: appState.get('conversationHistory').find(m => m.role === 'user')?.content?.substring(0, 100) || '',
      currentFile: lastFile,
      lastAction: toolName,
      result: result.substring(0, 200),
      stage: '执行中',
      time: new Date().toISOString(),
    });
  }

  return results;
}

// ==================== Agent 主循环 ====================

export async function runAgent(userInput: string): Promise<void> {
  appState.get('conversationHistory').push({ role: 'user', content: userInput });
  appState.set('historyData', saveHistory(appState.get('historyData'), appState.get('currentSessionId'), 'user', userInput));

  await compactContext();

  const messages: Message[] = [
    { role: 'system', content: buildSystemPrompt(userInput) },
    ...appState.get('conversationHistory'),
  ];

  let response = await callLLM(messages);

  let iterations = 0;
  while (true) {
    appState.get('conversationHistory').push(response);
    appState.set('historyData', saveHistory(appState.get('historyData'), appState.get('currentSessionId'), 'assistant', response.content || JSON.stringify(response)));

    if (response.content) {
      console.log(`\n[${formatTimeShort()}] 💬 [助手]\n${response.content}\n`);
    }

    const toolCalls = (response as OpenAI.Chat.Completions.ChatCompletionMessage).tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    iterations++;
    if (iterations > MAX_TOOL_ITERATIONS) {
      console.log(`[警告] 已达到最大工具调用轮数 (${MAX_TOOL_ITERATIONS})，强制停止`);
      break;
    }

    const results = await handleToolCalls(response as OpenAI.Chat.Completions.ChatCompletionMessage);

    for (let i = 0; i < toolCalls.length; i++) {
      appState.get('conversationHistory').push({
        role: 'tool',
        content: results[i],
        tool_call_id: toolCalls[i].id,
      });
    }

    const nextMessages: Message[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...appState.get('conversationHistory'),
    ];
    response = await callLLM(nextMessages);
  }

  writeCheckpoint({
    sessionId: appState.get('currentSessionId'),
    task: userInput.substring(0, 100),
    currentFile: '',
    lastAction: '对话',
    result: response.content?.substring(0, 200) || '',
    stage: '完成',
    time: new Date().toISOString(),
  });
}
