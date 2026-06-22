/**
 * UI 渲染模块 - 终端彩色输出
 * 使用 chalk 渲染工具调用结果、助手回复、错误、警告等信息
 * 如果 chalk 不可用，自动回退到普通 console.log
 */

import chalk from 'chalk';

// ========== 工具调用结果渲染 ==========

export function renderToolResult(name: string, args: object, result: string, ms: number): void {
  const isError = result.startsWith('错误:') || result.startsWith('错误：');
  const border = isError ? chalk.red('│') : chalk.green('│');
  const header = isError ? chalk.red('✗') : chalk.green('✓');
  const toolName = chalk.cyan(name);
  const argsStr = chalk.gray(JSON.stringify(args));
  const timeStr = chalk.gray(`${ms}ms`);

  console.log(`
${chalk.gray('┌─')} ${toolName} ${argsStr}
${border} ${header} ${timeStr}`);

  const lines = result.split('\n');
  for (const line of lines.slice(0, 20)) {
    console.log(`${border} ${line}`);
  }
  if (lines.length > 20) {
    console.log(`${border} ${chalk.gray(`... (${lines.length - 20} 行省略)`)}`);
  }

  console.log(`${chalk.gray('└─')}`);
}

// ========== 助手回复渲染 ==========

export function renderAssistant(content: string): void {
  console.log(`\n${chalk.blue('💬')} ${chalk.bold('助手')}`);
  console.log(chalk.gray('─'.repeat(50)));
  console.log(content);
  console.log();
}

// ========== 错误渲染 ==========

export function renderError(message: string): void {
  console.log(`\n${chalk.red('✗')} ${chalk.red.bold('错误')}`);
  console.log(chalk.red('─'.repeat(50)));
  console.log(chalk.red(message));
  console.log();
}

// ========== 警告渲染 ==========

export function renderWarning(message: string): void {
  console.log(`${chalk.yellow('⚠')} ${chalk.yellow(message)}`);
}

// ========== 成功渲染 ==========

export function renderSuccess(message: string): void {
  console.log(`${chalk.green('✓')} ${chalk.green(message)}`);
}

// ========== 信息渲染 ==========

export function renderInfo(label: string, value: string): void {
  console.log(`${chalk.gray(label)} ${chalk.white(value)}`);
}

// ========== 进度渲染 ==========

export function renderProgress(current: number, total: number, label: string): void {
  const pct = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  console.log(`${chalk.cyan(label)} [${bar}] ${pct}% (${current}/${total})`);
}

// ========== 分隔线 ==========

export function renderDivider(): void {
  console.log(chalk.gray('─'.repeat(50)));
}

// ========== 命令提示渲染 ==========

export function renderCommandHint(): void {
  console.log(chalk.gray('提示: 输入 / 后按 Tab 可补全命令，直接输入 / 回车查看全部'));
}
