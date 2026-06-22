/**
 * 技能系统
 *
 * 功能：
 * 1. 从 skill-lib.md 解析技能列表（兼容 /distill 输出的格式）
 * 2. 支持 /skill 命令（list / show / reload）
 * 3. 自动匹配：根据用户输入文本找出最相关的技能（关键词打分）
 * 4. 把匹配的技能注入到 System Prompt，提示 LLM 优先复用
 *
 * skill-lib.md 示例格式：
 * # 技能库
 * 生成时间: ...
 *
 * ## 技能名称
 * - 步骤1: xxx
 * - 步骤2: yyy
 * - 命令: npm run build
 * - 适用场景: 打包前端项目
 */

import * as fs from 'fs';

export interface Skill {
  name: string;
  steps: string[];
  commands: string[];
  scenario: string;
  raw: string;       // 原始 Markdown 片段
}

const SKILL_LIB_FILE = 'skill-lib.md';
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '这', '那', '什么', '吧', '啊', '吗', '呢', '把', '它', '他', '她', '我们',
  '可以', '请', '帮我', '如何', '怎么', '怎样',
]);

/** 解析 skill-lib.md */
export function parseSkillLib(content: string): Skill[] {
  const skills: Skill[] = [];
  const lines = content.split('\n');

  let current: Partial<Skill> | null = null;
  let rawLines: string[] = [];

  const flush = () => {
    if (current && current.name) {
      skills.push({
        name: current.name,
        steps: current.steps || [],
        commands: current.commands || [],
        scenario: current.scenario || '',
        raw: rawLines.join('\n').trim(),
      });
    }
    current = null;
    rawLines = [];
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      // 跳过总标题 "# 技能库" 之外的所有 ## 段
      const title = m[1].trim();
      if (/技能库|Skill ?Lib/i.test(title)) continue;
      flush();
      current = { name: title, steps: [], commands: [] };
      rawLines.push(line);
      continue;
    }
    if (!current) continue;
    rawLines.push(line);

    const stepMatch = line.match(/^-\s*步骤\s*\d+\s*[:：]\s*(.+)$/);
    if (stepMatch) {
      current.steps = current.steps || [];
      current.steps.push(stepMatch[1].trim());
      continue;
    }
    const cmdMatch = line.match(/^-\s*命令\s*[:：]\s*(.+)$/);
    if (cmdMatch) {
      current.commands = current.commands || [];
      // 支持多条命令（分号或换行分隔）
      for (const c of cmdMatch[1].split(/[;；]/)) {
        const trimmed = c.trim();
        if (trimmed) current.commands.push(trimmed);
      }
      continue;
    }
    const scenarioMatch = line.match(/^-\s*适用场景\s*[:：]\s*(.+)$/);
    if (scenarioMatch) {
      current.scenario = scenarioMatch[1].trim();
      continue;
    }
  }
  flush();
  return skills;
}

/** 从磁盘加载技能（带缓存） */
let cache: { mtime: number; skills: Skill[] } | null = null;

export function loadSkills(): Skill[] {
  try {
    if (!fs.existsSync(SKILL_LIB_FILE)) return [];
    const stat = fs.statSync(SKILL_LIB_FILE);
    if (cache && cache.mtime === stat.mtimeMs) return cache.skills;
    const content = fs.readFileSync(SKILL_LIB_FILE, 'utf-8');
    const skills = parseSkillLib(content);
    cache = { mtime: stat.mtimeMs, skills };
    return skills;
  } catch {
    return [];
  }
}

/** 强制重载（写完技能库后调用） */
export function reloadSkills(): Skill[] {
  cache = null;
  return loadSkills();
}

/** 分词（粗略的 CJK + ASCII 切分） */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // CJK 单字
  const cjk = text.match(/[\u4e00-\u9fff]/g);
  if (cjk) tokens.push(...cjk);
  // ASCII 单词
  const ascii = text.match(/[A-Za-z][A-Za-z0-9_-]+/g);
  if (ascii) tokens.push(...ascii.map(w => w.toLowerCase()));
  // 过滤停用词与单字符 CJK
  return tokens.filter(t => {
    if (STOP_WORDS.has(t.toLowerCase())) return false;
    if (/^[\u4e00-\u9fff]$/.test(t) && STOP_WORDS.has(t)) return false;
    return t.length > 0;
  });
}

/** 关键词打分（技能匹配输入文本） */
export function scoreSkill(skill: Skill, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const skillText = [
    skill.name,
    skill.scenario,
    ...skill.steps,
    ...skill.commands,
  ].join('\n');
  const skillTokens = new Set(tokenize(skillText));
  if (skillTokens.size === 0) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (skillTokens.has(t)) hits++;
  }
  return hits / Math.sqrt(skillTokens.size); // 归一化
}

/** 找出与输入最相关的技能（top N） */
export function matchSkill(text: string, topN = 2): Skill[] {
  const skills = loadSkills();
  if (skills.length === 0) return [];
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const scored = skills
    .map(s => ({ skill: s, score: scoreSkill(s, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  return scored.map(x => x.skill);
}

/** 把匹配的技能渲染成可注入 Prompt 的 Markdown */
export function formatSkillForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  return skills
    .map(s => `### ${s.name}\n- 适用场景: ${s.scenario || '(未描述)'}\n${s.commands.length ? `- 命令: \`${s.commands.join('` / `')}\`` : ''}`)
    .join('\n\n');
}