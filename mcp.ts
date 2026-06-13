/**
 * MCP 风格工具加载器（轻量版）
 *
 * 不实现完整的 Model Context Protocol（JSON-RPC over stdio/HTTP），
 * 但提供与其一致的"工具即插拔"体验：
 *
 * - 通过 `mcp-tools.json` 或 `mcp-tools/*.json` 声明外部工具
 * - 每个工具通过 JSON 描述：name / description / parameters / commandTemplate
 * - commandTemplate 中用 `{{var}}` 占位符引用参数
 * - 注册时自动转换为内部 Tool 形态，并接入工具系统
 *
 * 示例 mcp-tools.json：
 * [
 *   {
 *     "name": "httpGet",
 *     "description": "发起 HTTP GET 请求",
 *     "parameters": {
 *       "type": "object",
 *       "properties": {
 *         "url": { "type": "string", "description": "目标 URL" }
 *       },
 *       "required": ["url"]
 *     },
 *     "commandTemplate": "curl -sSL {{url}}",
 *     "timeout": 15000
 *   }
 * ]
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tool } from './types';

export interface McpToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  commandTemplate: string;
  timeout?: number;
}

const MCP_DIR = 'mcp-tools';
const MCP_FILE = 'mcp-tools.json';

/** Shell 转义：用单引号包裹，内部单引号转义 */
function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/** 用对象参数渲染 {{var}} 占位符，值自动做 shell 转义防注入 */
export function renderTemplate(tpl: string, args: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = args[key];
    if (v === undefined || v === null) return "''";
    if (Array.isArray(v)) return v.map(x => shellEscape(String(x))).join(' ');
    return shellEscape(String(v));
  });
}

/** 把 McpToolSpec 转换为内部 Tool（底层走 shell 执行） */
export function mcpSpecToTool(spec: McpToolSpec, shellExecutor: (cmd: string, timeout?: number) => Promise<string>): Tool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    source: 'mcp',
    execute: async (args) => {
      const cmd = renderTemplate(spec.commandTemplate, args);
      if (!cmd.trim()) {
        return `错误: 渲染后的命令为空，请检查模板与参数`;
      }
      try {
        return await shellExecutor(cmd, spec.timeout);
      } catch (error) {
        return `MCP 工具 ${spec.name} 执行失败: ${(error as Error).message}`;
      }
    },
  };
}

/** 从配置目录加载所有 MCP 工具规范 */
export function loadMcpSpecs(): McpToolSpec[] {
  const specs: McpToolSpec[] = [];

  // 1. 单文件配置
  if (fs.existsSync(MCP_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(MCP_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (validateSpec(item)) specs.push(item);
        }
      }
    } catch (e) {
      console.warn(`[MCP] 解析 ${MCP_FILE} 失败: ${(e as Error).message}`);
    }
  }

  // 2. 目录配置：每个 .json 文件一个工具
  if (fs.existsSync(MCP_DIR) && fs.statSync(MCP_DIR).isDirectory()) {
    for (const file of fs.readdirSync(MCP_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const spec = JSON.parse(fs.readFileSync(path.join(MCP_DIR, file), 'utf-8'));
        if (validateSpec(spec)) specs.push(spec);
      } catch (e) {
        console.warn(`[MCP] 解析 ${file} 失败: ${(e as Error).message}`);
      }
    }
  }

  return specs;
}

function validateSpec(spec: unknown): spec is McpToolSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  return typeof s.name === 'string'
    && typeof s.description === 'string'
    && typeof s.commandTemplate === 'string'
    && typeof s.parameters === 'object';
}

/** 把 MCP 工具规范转换为 Tool[] */
export function loadMcpTools(shellExecutor: (cmd: string, timeout?: number) => Promise<string>): Tool[] {
  return loadMcpSpecs().map(spec => mcpSpecToTool(spec, shellExecutor));
}