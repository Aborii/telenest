/**
 * @file src/lib/bot/telegram-bot.factory.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the Telegraf factory: configuration validation and instance
 * construction. No network is involved — a `Telegraf` instance can be built
 * from any non-empty token string without contacting Telegram.
 */

import { Telegraf } from 'telegraf';
import { TelegramConfigError } from '../common';
import { createTelegrafInstance } from './telegram-bot.factory';

describe('createTelegrafInstance', () => {
  it('builds a Telegraf instance for a valid token', () => {
    const bot = createTelegrafInstance({ token: '123456:ABCDEF' });
    expect(bot).toBeInstanceOf(Telegraf);
  });

  it('throws TelegramConfigError for an empty token', () => {
    expect(() => createTelegrafInstance({ token: '' })).toThrow(
      TelegramConfigError,
    );
  });

  it('throws TelegramConfigError for a whitespace-only token', () => {
    expect(() => createTelegrafInstance({ token: '   ' })).toThrow(
      TelegramConfigError,
    );
  });
});
