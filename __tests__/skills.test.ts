import { describe, it, expect } from 'vitest';
import { scoreSkill, matchSkill, parseSkillLib, tokenize } from '../skills';
import type { Skill } from '../skills';

describe('parseSkillLib', () => {
  it('should parse valid skill lib', () => {
    const content = `# 技能库

## 创建组件
- 步骤1: 分析需求
- 步骤2: 创建文件
- 命令: npm run build
- 适用场景: 前端开发

## 调试错误
- 步骤1: 读取日志
- 命令: npm test
- 适用场景: 排查 Bug
`;
    const skills = parseSkillLib(content);
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe('创建组件');
    expect(skills[0].steps).toHaveLength(2);
    expect(skills[0].commands).toEqual(['npm run build']);
    expect(skills[1].name).toBe('调试错误');
  });

  it('should return empty for empty content', () => {
    expect(parseSkillLib('')).toHaveLength(0);
  });
});

describe('tokenize', () => {
  it('should split CJK characters', () => {
    const tokens = tokenize('创建文件');
    expect(tokens).toContain('创');
    expect(tokens).toContain('建');
  });

  it('should split ASCII words', () => {
    const tokens = tokenize('npm install');
    expect(tokens).toContain('npm');
    expect(tokens).toContain('install');
  });

  it('should filter stop words', () => {
    const tokens = tokenize('帮我创建一个文件');
    // '我' is in STOP_WORDS as a single entry
    expect(tokens).not.toContain('我');
    // '帮' is not in STOP_WORDS individually (only '帮我' is), so it passes through
    // '个' is not in STOP_WORDS, so it passes through
  });
});

describe('scoreSkill', () => {
  const skill: Skill = {
    name: '创建组件',
    steps: ['分析需求', '创建文件'],
    commands: ['npm run build'],
    scenario: '前端开发',
    raw: '',
  };

  it('should return 0 for empty tokens', () => {
    expect(scoreSkill(skill, [])).toBe(0);
  });

  it('should score higher for more matching tokens', () => {
    // tokenize splits CJK into single chars, so skill '创建组件' -> ['创','建','组','件']
    // scenario '前端开发' -> ['前','端','开','发']
    // We pass single-char tokens that match the skill's tokenized form
    const highScore = scoreSkill(skill, ['创', '建', '前']);
    const lowScore = scoreSkill(skill, ['调', '试']);
    expect(highScore).toBeGreaterThan(lowScore);
  });
});
