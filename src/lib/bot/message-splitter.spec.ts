/**
 * @file src/lib/bot/message-splitter.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link splitMessageText}: the empty/fast paths, line-boundary
 * packing, hard-splitting of over-long single lines, and the invariant that no
 * emitted chunk ever exceeds the limit.
 */

import {
  splitMessageText,
  TELEGRAM_MESSAGE_MAX_LENGTH,
} from './message-splitter';

describe('splitMessageText', () => {
  it('exposes the Telegram 4096-code-unit limit', () => {
    expect(TELEGRAM_MESSAGE_MAX_LENGTH).toBe(4096);
  });

  it('returns an empty array for empty input', () => {
    expect(splitMessageText('')).toEqual([]);
  });

  it('returns the text unchanged when it already fits', () => {
    expect(splitMessageText('a\nb\nc')).toEqual(['a\nb\nc']);
  });

  it('packs whole lines into the fewest chunks that fit', () => {
    // Each line is 3 chars ('aaa'); with a limit of 7, two lines (3+1+3=7) fit
    // per chunk and the third spills over.
    const text = ['aaa', 'aaa', 'aaa'].join('\n');
    expect(splitMessageText(text, 7)).toEqual(['aaa\naaa', 'aaa']);
  });

  it('hard-splits a single line longer than the limit', () => {
    const chunks = splitMessageText('x'.repeat(10), 4);
    expect(chunks).toEqual(['xxxx', 'xxxx', 'xx']);
  });

  it('never splits a surrogate pair when hard-splitting a long line', () => {
    // Six emoji (😀 = 2 UTF-16 code units each = 12 units) with limit 5: a naive
    // slice(0,5) would cut the 3rd emoji's surrogate pair in half.
    const line = '😀'.repeat(6);
    const chunks = splitMessageText(line, 5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
      // A well-formed chunk has no lone surrogate at either edge.
      expect(/[\uD800-\uDBFF]$/.test(chunk)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(chunk)).toBe(false);
    }
    // Re-joining reconstructs the original with every emoji intact.
    expect(chunks.join('')).toBe(line);
    expect([...chunks.join('')].length).toBe(6);
  });

  it('seeds the next chunk with a long-line remainder so following lines pack', () => {
    // 'xxxxx' (5) with limit 4 → 'xxxx' flushed, 'x' remainder; then 'y' packs
    // onto the remainder as 'x\ny' (3 ≤ 4).
    expect(splitMessageText('xxxxx\ny', 4)).toEqual(['xxxx', 'x\ny']);
  });

  it('never emits a chunk longer than the limit (mixed content)', () => {
    const text = Array.from({ length: 50 }, (_, i) =>
      'z'.repeat((i % 9) + 1),
    ).join('\n');
    for (const chunk of splitMessageText(text, 10)) {
      expect(chunk.length).toBeLessThanOrEqual(10);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('preserves all content across the join boundaries', () => {
    const text = 'hello\nworld\nfoo\nbar';
    // Re-joining the line-boundary chunks with '\n' reconstructs the original
    // (no characters lost when splitting purely on newlines).
    expect(splitMessageText(text, 9).join('\n')).toBe(text);
  });

  it('rejects a non-positive or non-integer limit', () => {
    expect(() => splitMessageText('x', 0)).toThrow(RangeError);
    expect(() => splitMessageText('x', -5)).toThrow(RangeError);
    expect(() => splitMessageText('x', 1.5)).toThrow(RangeError);
  });
});
