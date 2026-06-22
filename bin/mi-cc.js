#!/usr/bin/env node
/**
 * mi-cc 全局命令入口
 * 
 * 使用方法：
 *   mi-cc                    # 直接启动
 *   mi-cc /help              # 查看帮助
 *   mi-cc -s <session_id>    # 指定会话 ID
 *   mi-cc --mcp              # MCP Server 模式
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 默认配置
const DEFAULT_CONFIG = {
  BASE_URL: 'https://token-plan-cn.xiaomimimo.com/v1',
  MODEL: 'mimo-v2.5-pro',
  MAX_TOKEN: '8000'
};

// 查找 .env 文件（向上查找）
function findEnvPath(startDir) {
  let envPath = startDir;
  const maxDepth = 5;
  for (let i = 0; i < maxDepth; i++) {
    const testPath = path.join(envPath, '.env');
    if (fs.existsSync(testPath)) {
      return testPath;
    }
    const parent = path.dirname(envPath);
    if (parent === envPath) break;
    envPath = parent;
  }
  return null;
}

// 创建交互式输入接口
function createPrompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// 首次运行配置向导
async function setupWizard() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           mi-cc 首次运行配置向导                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  console.log('即将进行首次配置，请按 Enter 使用默认设置，或输入自定义值。\n');
  console.log(`默认配置:`);
  console.log(`  API Base URL: ${DEFAULT_CONFIG.BASE_URL}`);
  console.log(`  模型名称: ${DEFAULT_CONFIG.MODEL}`);
  console.log(`  最大 Token: ${DEFAULT_CONFIG.MAX_TOKEN}\n`);
  
  // 获取 API Key
  const apiKey = await createPrompt('请输入您的 API Key: ');
  
  if (!apiKey.trim()) {
    console.log('\n[错误] API Key 不能为空，请重新运行 mi-cc 配置。\n');
    process.exit(1);
  }
  
  // 可选配置
  const baseUrl = await createPrompt(`API Base URL (默认: ${DEFAULT_CONFIG.BASE_URL}): `) || DEFAULT_CONFIG.BASE_URL;
  const model = await createPrompt(`模型名称 (默认: ${DEFAULT_CONFIG.MODEL}): `) || DEFAULT_CONFIG.MODEL;
  const maxToken = await createPrompt(`最大 Token (默认: ${DEFAULT_CONFIG.MAX_TOKEN}): `) || DEFAULT_CONFIG.MAX_TOKEN;
  
  // 生成 .env 文件
  const envContent = `API_KEY=${apiKey.trim()}
BASE_URL=${baseUrl.trim()}
MODEL=${model.trim()}
MAX_TOKEN=${maxToken.trim()}
`;
  
  const envPath = path.join(process.cwd(), '.env');
  fs.writeFileSync(envPath, envContent, 'utf-8');
  
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                   配置保存成功！                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\n配置文件已保存到: ${envPath}`);
  console.log('现在可以重新运行 mi-cc 开始使用。\n');
  
  process.exit(0);
}

// 主程序入口
async function main() {
  const envPath = findEnvPath(process.cwd());
  
  // 检查是否需要首次配置
  const args = process.argv.slice(2);
  
  // 如果没有任何参数且没有找到配置文件，引导配置
  if (!envPath && args.length === 0) {
    await setupWizard();
    return;
  }
  
  // 加载环境变量
  if (envPath) {
    require('dotenv').config({ path: envPath });
    console.log(`[加载配置] ${envPath}`);
  }
  
  // 使用 tsx 运行主程序
  const { spawn } = require('child_process');
  function resolveTsxCliPath() {
    try {
      const pkgPath = require.resolve('tsx/package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.bin) {
        const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.tsx;
        if (binRel) {
          const abs = path.join(path.dirname(pkgPath), binRel);
          if (fs.existsSync(abs)) return abs;
        }
      }
    } catch {}
    let cur = path.join(__dirname, '..');
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(cur, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return null;
  }

  const tsxPath = resolveTsxCliPath();
  if (!tsxPath) {
    console.error('[mi-cc] 找不到 tsx CLI 入口，请先在项目目录执行 npm install');
    process.exit(1);
  }

  const child = spawn(process.execPath, [tsxPath, 'mimo-cli.ts', ...args], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: process.env
  });
  
  child.on('exit', (code) => {
    process.exit(code);
  });
}

main();
