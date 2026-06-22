/**
 * @file src/lib/testing/dto-builders.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the DTO fixture builders return well-typed defaults, apply overrides,
 * and never share mutable state between calls.
 */

import { aGramDialog, aGramMessage, aGramUser } from './dto-builders';

describe('DTO builders', () => {
  describe('aGramUser', () => {
    it('returns a self-account user by default', () => {
      expect(aGramUser()).toEqual({
        id: '1000',
        isSelf: true,
        isBot: false,
        isPremium: false,
        firstName: 'Test',
        username: 'test_user',
      });
    });

    it('applies overrides over the defaults', () => {
      const bot = aGramUser({ isSelf: false, isBot: true, username: 'my_bot' });
      expect(bot.isSelf).toBe(false);
      expect(bot.isBot).toBe(true);
      expect(bot.username).toBe('my_bot');
      // Untouched fields keep their defaults.
      expect(bot.id).toBe('1000');
    });

    it('produces an independent object on every call', () => {
      const a = aGramUser();
      const b = aGramUser();
      expect(a).not.toBe(b);
      a.username = 'mutated';
      expect(b.username).toBe('test_user');
    });
  });

  describe('aGramMessage', () => {
    it('returns an outgoing text message by default', () => {
      expect(aGramMessage()).toEqual({
        id: 1,
        peerId: '1000',
        text: 'test message',
        date: 1_700_000_000,
        out: true,
      });
    });

    it('applies overrides (e.g. an incoming message)', () => {
      const incoming = aGramMessage({
        out: false,
        senderId: '2002',
        text: 'hi',
      });
      expect(incoming.out).toBe(false);
      expect(incoming.senderId).toBe('2002');
      expect(incoming.text).toBe('hi');
    });
  });

  describe('aGramDialog', () => {
    it('returns an unread-free user dialog by default', () => {
      expect(aGramDialog()).toEqual({
        id: '1000',
        title: 'Test Dialog',
        type: 'user',
        unreadCount: 0,
        pinned: false,
      });
    });

    it('applies overrides (e.g. a busy channel)', () => {
      const channel = aGramDialog({
        type: 'channel',
        title: 'News',
        unreadCount: 9,
        pinned: true,
      });
      expect(channel.type).toBe('channel');
      expect(channel.title).toBe('News');
      expect(channel.unreadCount).toBe(9);
      expect(channel.pinned).toBe(true);
    });
  });
});
