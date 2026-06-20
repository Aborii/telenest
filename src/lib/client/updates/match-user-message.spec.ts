/**
 * @file src/lib/client/updates/match-user-message.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the inbound-message filter predicate.
 */

import type { GramMessage } from '../gram-client.types';
import { matchesUserMessageFilter } from './match-user-message';

/** Builds a message DTO with overridable fields. */
function msg(overrides: Partial<GramMessage> = {}): GramMessage {
  return {
    id: 1,
    peerId: '555',
    text: 'hello',
    date: 0,
    out: false,
    ...overrides,
  };
}

describe('matchesUserMessageFilter', () => {
  it('matches everything for an empty filter', () => {
    expect(matchesUserMessageFilter(msg(), {})).toBe(true);
    expect(matchesUserMessageFilter(msg({ out: true }), {})).toBe(true);
  });

  describe('direction', () => {
    it('incoming matches only non-self messages', () => {
      expect(matchesUserMessageFilter(msg({ out: false }), { incoming: true })).toBe(true);
      expect(matchesUserMessageFilter(msg({ out: true }), { incoming: true })).toBe(false);
    });

    it('outgoing matches only self messages', () => {
      expect(matchesUserMessageFilter(msg({ out: true }), { outgoing: true })).toBe(true);
      expect(matchesUserMessageFilter(msg({ out: false }), { outgoing: true })).toBe(false);
    });
  });

  describe('pattern', () => {
    it('tests a RegExp against the text', () => {
      expect(matchesUserMessageFilter(msg({ text: 'ping' }), { pattern: /^ping$/ })).toBe(true);
      expect(matchesUserMessageFilter(msg({ text: 'pong' }), { pattern: /^ping$/ })).toBe(false);
    });

    it('requires exact equality for a string', () => {
      expect(matchesUserMessageFilter(msg({ text: 'hi' }), { pattern: 'hi' })).toBe(true);
      expect(matchesUserMessageFilter(msg({ text: 'hi there' }), { pattern: 'hi' })).toBe(false);
    });

    it('is stable across calls for a globally-flagged RegExp (no lastIndex drift)', () => {
      const filter = { pattern: /ping/g };
      // ── Without resetting lastIndex, the 2nd identical test would return
      //    false; it must stay true. ─────────────────────────────────────────
      expect(matchesUserMessageFilter(msg({ text: 'ping' }), filter)).toBe(true);
      expect(matchesUserMessageFilter(msg({ text: 'ping' }), filter)).toBe(true);
      expect(matchesUserMessageFilter(msg({ text: 'ping' }), filter)).toBe(true);
    });
  });

  describe('chatId', () => {
    it('matches a single id', () => {
      expect(matchesUserMessageFilter(msg({ peerId: '555' }), { chatId: 555 })).toBe(true);
      expect(matchesUserMessageFilter(msg({ peerId: '777' }), { chatId: 555 })).toBe(false);
    });

    it('matches any id in an array', () => {
      expect(matchesUserMessageFilter(msg({ peerId: '777' }), { chatId: ['555', '777'] })).toBe(true);
      expect(matchesUserMessageFilter(msg({ peerId: '999' }), { chatId: ['555', '777'] })).toBe(false);
    });
  });

  it('ANDs every present criterion', () => {
    const message = msg({ out: false, text: 'ping', peerId: '555' });
    expect(
      matchesUserMessageFilter(message, { incoming: true, pattern: /ping/, chatId: '555' }),
    ).toBe(true);
    // One mismatch (wrong chat) fails the whole filter.
    expect(
      matchesUserMessageFilter(message, { incoming: true, pattern: /ping/, chatId: '999' }),
    ).toBe(false);
  });
});
