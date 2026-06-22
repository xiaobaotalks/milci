import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  isContextLengthError,
  resolveContextWindow,
  isSummaryMessage,
  parseSummaryLayer,
  splitMessages,
  COMPRESS_TIERS,
  RECENT_TURNS_STANDARD,
  RECENT_TURNS_URGENT,
} from '../compress';
import type { Message } from '../types';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate CJK characters at 1.6 tokens each', () => {
    const text = '你好世界'; // 4 CJK chars
    expect(estimateTokens(text)).toBe(Math.ceil(4 * 1.6)); // 7
  });

  it('should estimate ASCII characters at 0.3 tokens each', () => {
    const text = 'hello world'; // 11 ASCII chars
    expect(estimateTokens(text)).toBe(Math.ceil(11 * 0.3)); // 4
  });

  it('should handle mixed CJK and ASCII', () => {
    const text = 'hello你好'; // 5 ASCII + 2 CJK
    const expected = Math.ceil(2 * 1.6 + 5 * 0.3); // 4.7 -> 5
    expect(estimateTokens(text)).toBe(expected);
  });
});

describe('estimateMessageTokens', () => {
  it('should add 4 token overhead per message', () => {
    const msg: Message = { role: 'user', content: 'test' };
    expect(estimateMessageTokens(msg)).toBe(estimateTokens('test') + 4);
  });

  it('should estimate tool_calls tokens', () => {
    const msg: Message = {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'readFile', arguments: '{"path":"test.ts"}' },
      }],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('estimateTotalTokens', () => {
  it('should sum tokens for all messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    const total = estimateTotalTokens(messages);
    expect(total).toBeGreaterThan(0);
  });
});

describe('isContextLengthError', () => {
  it('should detect context length errors', () => {
    expect(isContextLengthError(new Error('context_length_exceeded'))).toBe(true);
    expect(isContextLengthError(new Error('maximum context length'))).toBe(true);
    expect(isContextLengthError(new Error('prompt is too long'))).toBe(true);
  });

  it('should not match unrelated errors', () => {
    expect(isContextLengthError(new Error('network error'))).toBe(false);
    expect(isContextLengthError(null)).toBe(false);
  });
});

describe('resolveContextWindow', () => {
  it('should return known model windows', () => {
    expect(resolveContextWindow('gpt-4o')).toBe(128_000);
    expect(resolveContextWindow('claude-3-5-sonnet-20241022')).toBe(200_000);
    expect(resolveContextWindow('mimo-v2-flash')).toBe(1_000_000);
  });

  it('should return null for unknown models', () => {
    expect(resolveContextWindow('unknown-model-xyz')).toBeNull();
  });

  it('should do fuzzy matching', () => {
    expect(resolveContextWindow('gpt-4o-mini')).toBe(128_000);
  });
});

describe('isSummaryMessage', () => {
  it('should detect summary messages', () => {
    expect(isSummaryMessage({ role: 'system', content: '[历史摘要 L0 @ 2026-01-01]\ntest' })).toBe(true);
    expect(isSummaryMessage({ role: 'system', content: '[历史摘要 L1 @ 2026-01-01]\ntest' })).toBe(true);
  });

  it('should not match non-summary messages', () => {
    expect(isSummaryMessage({ role: 'user', content: 'hello' })).toBe(false);
    expect(isSummaryMessage({ role: 'system', content: 'You are helpful' })).toBe(false);
  });
});

describe('parseSummaryLayer', () => {
  it('should parse valid summary messages', () => {
    const msg: Message = {
      role: 'system',
      content: '[历史摘要 L2 @ 2026-06-22T10:00:00Z]\nSome summary text',
    };
    const layer = parseSummaryLayer(msg);
    expect(layer).not.toBeNull();
    expect(layer!.level).toBe(2);
    expect(layer!.text).toBe('Some summary text');
    expect(layer!.createdAt).toBe('2026-06-22T10:00:00Z');
  });

  it('should return null for invalid messages', () => {
    expect(parseSummaryLayer({ role: 'user', content: 'hello' })).toBeNull();
  });
});

describe('splitMessages', () => {
  it('should split summary messages from raw messages', () => {
    const messages: Message[] = [
      { role: 'system', content: '[历史摘要 L0 @ 2026-01-01]\nSummary' },
      { role: 'system', content: '[历史摘要 L1 @ 2026-01-02]\nOlder' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const { headSummaries, rawMessages } = splitMessages(messages);
    expect(headSummaries).toHaveLength(2);
    expect(rawMessages).toHaveLength(2);
  });

  it('should handle no summaries', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
    ];
    const { headSummaries, rawMessages } = splitMessages(messages);
    expect(headSummaries).toHaveLength(0);
    expect(rawMessages).toHaveLength(1);
  });
});
