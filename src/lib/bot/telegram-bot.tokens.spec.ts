/**
 * @file src/lib/bot/telegram-bot.tokens.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the per-bot token helpers. They verify that the default bot
 * keeps its legacy tokens (the `TELEGRAM_BOT` symbol and the `TelegramBotService`
 * class) while named bots get distinct, stable string tokens — the property that
 * lets several bots coexist without colliding. No network or DI container is
 * involved; these are pure functions.
 */

import { DEFAULT_BOT_NAME, TELEGRAM_BOT } from './telegram-bot.constants';
import { TelegramBotService } from './telegram-bot.service';
import {
  getBotInstanceToken,
  getBotRegistrarToken,
  getBotToken,
  InjectBot,
} from './telegram-bot.tokens';
import { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';

describe('per-bot token helpers', () => {
  describe('getBotToken (facade)', () => {
    it('returns the TelegramBotService class for the default bot', () => {
      expect(getBotToken()).toBe(TelegramBotService);
      expect(getBotToken(DEFAULT_BOT_NAME)).toBe(TelegramBotService);
    });

    it('returns a distinct string token for a named bot', () => {
      expect(getBotToken('notify')).toBe('NESTJS_TELEGRAM_BOT_SERVICE:notify');
      expect(getBotToken('support')).toBe(
        'NESTJS_TELEGRAM_BOT_SERVICE:support',
      );
    });
  });

  describe('getBotInstanceToken (raw Telegraf)', () => {
    it('returns the TELEGRAM_BOT symbol for the default bot', () => {
      expect(getBotInstanceToken()).toBe(TELEGRAM_BOT);
      expect(getBotInstanceToken(DEFAULT_BOT_NAME)).toBe(TELEGRAM_BOT);
    });

    it('returns a distinct string token for a named bot', () => {
      expect(getBotInstanceToken('notify')).toBe(
        'NESTJS_TELEGRAM_BOT_INSTANCE:notify',
      );
    });
  });

  describe('getBotRegistrarToken', () => {
    it('returns the registrar class for the default bot', () => {
      expect(getBotRegistrarToken()).toBe(TelegramBotUpdatesRegistrar);
      expect(getBotRegistrarToken(DEFAULT_BOT_NAME)).toBe(
        TelegramBotUpdatesRegistrar,
      );
    });

    it('returns a distinct string token for a named bot', () => {
      expect(getBotRegistrarToken('notify')).toBe(
        'NESTJS_TELEGRAM_BOT_REGISTRAR:notify',
      );
    });
  });

  describe('token stability & uniqueness', () => {
    it('is deterministic — the same name always yields the same token', () => {
      expect(getBotToken('notify')).toBe(getBotToken('notify'));
      expect(getBotInstanceToken('notify')).toBe(getBotInstanceToken('notify'));
    });

    it('separates the three provider families for one name', () => {
      const tokens = new Set([
        getBotToken('notify'),
        getBotInstanceToken('notify'),
        getBotRegistrarToken('notify'),
      ]);
      expect(tokens.size).toBe(3);
    });
  });

  describe('InjectBot', () => {
    it('produces a usable decorator for both default and named bots', () => {
      // ── Exercises the helper for both branches; behavioural DI resolution is
      //    proven in the multi-bot integration spec. ───────────────────────────
      expect(typeof InjectBot()).toBe('function');
      expect(typeof InjectBot('notify')).toBe('function');
    });
  });
});
