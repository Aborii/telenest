/**
 * @file src/lib/bot/callback-data.codec.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the structured `callback_data` codec: round-tripping,
 * enforcement of Telegram's 64-byte limit, and rejection of values that cannot
 * be safely serialized or parsed.
 */

import {
  CALLBACK_DATA_MAX_BYTES,
  decodeCallbackData,
  encodeCallbackData,
} from './callback-data.codec';

describe('callback-data codec', () => {
  it('exposes the Telegram 64-byte limit', () => {
    expect(CALLBACK_DATA_MAX_BYTES).toBe(64);
  });

  describe('encodeCallbackData', () => {
    it('round-trips a structured payload', () => {
      const payload = { a: 'buy', id: 42 };
      const encoded = encodeCallbackData(payload);
      expect(JSON.parse(encoded)).toEqual(payload);
    });

    it('accepts a payload exactly at the 64-byte limit', () => {
      // 'x' repeated so the JSON string {"v":"xxx…"} is exactly 64 bytes.
      const filler = 'x'.repeat(CALLBACK_DATA_MAX_BYTES - '{"v":""}'.length);
      const encoded = encodeCallbackData({ v: filler });
      expect(Buffer.byteLength(encoded, 'utf8')).toBe(CALLBACK_DATA_MAX_BYTES);
    });

    it('rejects a payload exceeding 64 bytes with a RangeError', () => {
      const tooBig = { v: 'x'.repeat(100) };
      expect(() => encodeCallbackData(tooBig)).toThrow(RangeError);
    });

    it('counts bytes, not characters, against the limit', () => {
      // Each emoji is 4 UTF-8 bytes; 20 of them blow past 64 bytes despite
      // being far fewer than 64 JS characters.
      const emojiHeavy = { v: '😀'.repeat(20) };
      expect(() => encodeCallbackData(emojiHeavy)).toThrow(RangeError);
    });

    it('throws a TypeError for non-serializable values (BigInt)', () => {
      expect(() => encodeCallbackData({ n: 1n })).toThrow(TypeError);
    });

    it('throws a TypeError when serialization yields `undefined`', () => {
      expect(() => encodeCallbackData(undefined)).toThrow(TypeError);
      expect(() => encodeCallbackData(() => 1)).toThrow(TypeError);
    });
  });

  describe('decodeCallbackData', () => {
    it('parses a string produced by encodeCallbackData', () => {
      type Cb = { a: string; id: number };
      const encoded = encodeCallbackData<Cb>({ a: 'page', id: 3 });
      const decoded = decodeCallbackData<Cb>(encoded);
      expect(decoded).toEqual({ a: 'page', id: 3 });
    });

    it('throws a TypeError on invalid JSON', () => {
      expect(() => decodeCallbackData('not-json')).toThrow(TypeError);
    });
  });
});
