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

import {
  DEFAULT_BOT_NAME,
  TELEGRAM_BOT,
  TELEGRAM_BOT_METRICS,
  TELEGRAM_BOT_TRACER,
} from './telegram-bot.constants';
import { TelegramBotHealthIndicator } from './telegram-bot.health';
import { TelegramBotService } from './telegram-bot.service';
import {
  getBotHealthToken,
  getBotInstanceToken,
  getBotMetricsToken,
  getBotRegistrarToken,
  getBotToken,
  getBotTracerToken,
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

  describe('getBotMetricsToken', () => {
    it('returns the TELEGRAM_BOT_METRICS symbol for the default bot', () => {
      expect(getBotMetricsToken()).toBe(TELEGRAM_BOT_METRICS);
      expect(getBotMetricsToken(DEFAULT_BOT_NAME)).toBe(TELEGRAM_BOT_METRICS);
    });

    it('returns a distinct string token for a named bot', () => {
      expect(getBotMetricsToken('notify')).toBe(
        'NESTJS_TELEGRAM_BOT_METRICS:notify',
      );
    });
  });

  describe('getBotTracerToken', () => {
    it('returns the TELEGRAM_BOT_TRACER symbol for the default bot', () => {
      expect(getBotTracerToken()).toBe(TELEGRAM_BOT_TRACER);
      expect(getBotTracerToken(DEFAULT_BOT_NAME)).toBe(TELEGRAM_BOT_TRACER);
    });

    it('returns a distinct string token for a named bot', () => {
      expect(getBotTracerToken('notify')).toBe(
        'NESTJS_TELEGRAM_BOT_TRACER:notify',
      );
    });
  });

  describe('getBotHealthToken', () => {
    it('returns the health indicator class for the default bot', () => {
      expect(getBotHealthToken()).toBe(TelegramBotHealthIndicator);
      expect(getBotHealthToken(DEFAULT_BOT_NAME)).toBe(
        TelegramBotHealthIndicator,
      );
    });

    it('returns a distinct string token for a named bot', () => {
      expect(getBotHealthToken('notify')).toBe(
        'NESTJS_TELEGRAM_BOT_HEALTH:notify',
      );
    });
  });

  describe('token stability & uniqueness', () => {
    it('is deterministic — the same name always yields the same token', () => {
      expect(getBotToken('notify')).toBe(getBotToken('notify'));
      expect(getBotInstanceToken('notify')).toBe(getBotInstanceToken('notify'));
    });

    it('separates every provider family for one name', () => {
      const tokens = new Set([
        getBotToken('notify'),
        getBotInstanceToken('notify'),
        getBotRegistrarToken('notify'),
        getBotMetricsToken('notify'),
        getBotTracerToken('notify'),
        getBotHealthToken('notify'),
      ]);
      expect(tokens.size).toBe(6);
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
