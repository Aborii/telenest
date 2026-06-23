/**
 * @file src/lib/client/telegram-client.tokens.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the per-account token helpers. They verify that the default
 * account keeps its legacy tokens (the `TELEGRAM_GRAM_CLIENT` /
 * `TELEGRAM_SESSION_STORE` symbols and the service classes) while named accounts
 * get distinct, stable string tokens — the property that lets several accounts
 * coexist without colliding. Pure functions; no DI container or network.
 */

import { TelegramAuthService } from './telegram-auth.service';
import {
  DEFAULT_CLIENT_NAME,
  TELEGRAM_CLIENT_METRICS,
  TELEGRAM_GRAM_CLIENT,
  TELEGRAM_SESSION_STORE,
} from './telegram-client.constants';
import { TelegramClientHealthIndicator } from './telegram-client.health';
import { TelegramClientLifecycle } from './telegram-client.lifecycle';
import {
  getClientHealthToken,
  getClientLifecycleToken,
  getClientMetricsToken,
  getClientRegistrarToken,
  getGramClientToken,
  getSessionStoreToken,
  getTelegramAuthToken,
  getTelegramUserToken,
  InjectTelegramAuth,
  InjectTelegramUser,
} from './telegram-client.tokens';
import { TelegramUserService } from './telegram-user.service';
import { TelegramUserUpdatesRegistrar } from './updates/telegram-user-updates.registrar';

describe('per-account token helpers', () => {
  describe('default account → legacy tokens', () => {
    it('maps each provider to its original token for the default account', () => {
      expect(getGramClientToken()).toBe(TELEGRAM_GRAM_CLIENT);
      expect(getGramClientToken(DEFAULT_CLIENT_NAME)).toBe(
        TELEGRAM_GRAM_CLIENT,
      );
      expect(getSessionStoreToken()).toBe(TELEGRAM_SESSION_STORE);
      expect(getTelegramAuthToken()).toBe(TelegramAuthService);
      expect(getTelegramUserToken()).toBe(TelegramUserService);
      expect(getClientLifecycleToken()).toBe(TelegramClientLifecycle);
      expect(getClientRegistrarToken()).toBe(TelegramUserUpdatesRegistrar);
      expect(getClientMetricsToken()).toBe(TELEGRAM_CLIENT_METRICS);
      expect(getClientHealthToken()).toBe(TelegramClientHealthIndicator);
    });
  });

  describe('named account → derived string tokens', () => {
    it('derives a distinct string token per provider family', () => {
      expect(getGramClientToken('personal')).toBe(
        'NESTJS_TELEGRAM_GRAM_CLIENT:personal',
      );
      expect(getSessionStoreToken('personal')).toBe(
        'NESTJS_TELEGRAM_SESSION_STORE:personal',
      );
      expect(getTelegramAuthToken('personal')).toBe(
        'NESTJS_TELEGRAM_AUTH_SERVICE:personal',
      );
      expect(getTelegramUserToken('personal')).toBe(
        'NESTJS_TELEGRAM_USER_SERVICE:personal',
      );
      expect(getClientMetricsToken('personal')).toBe(
        'NESTJS_TELEGRAM_CLIENT_METRICS:personal',
      );
      expect(getClientHealthToken('personal')).toBe(
        'NESTJS_TELEGRAM_CLIENT_HEALTH:personal',
      );
    });
  });

  describe('stability & uniqueness', () => {
    it('is deterministic — the same name always yields the same token', () => {
      expect(getTelegramUserToken('ops')).toBe(getTelegramUserToken('ops'));
      expect(getGramClientToken('ops')).toBe(getGramClientToken('ops'));
    });

    it('separates every provider family for one account name', () => {
      const tokens = new Set([
        getGramClientToken('ops'),
        getSessionStoreToken('ops'),
        getTelegramAuthToken('ops'),
        getTelegramUserToken('ops'),
        getClientLifecycleToken('ops'),
        getClientRegistrarToken('ops'),
        getClientMetricsToken('ops'),
        getClientHealthToken('ops'),
      ]);
      expect(tokens.size).toBe(8);
    });

    it('keeps two different accounts on different tokens', () => {
      expect(getTelegramUserToken('a')).not.toBe(getTelegramUserToken('b'));
    });
  });

  describe('inject decorators', () => {
    it('produce usable decorators for both default and named accounts', () => {
      // ── Exercises both branches; behavioural DI resolution is proven in the
      //    multi-account integration spec. ──────────────────────────────────────
      expect(typeof InjectTelegramUser()).toBe('function');
      expect(typeof InjectTelegramUser('personal')).toBe('function');
      expect(typeof InjectTelegramAuth()).toBe('function');
      expect(typeof InjectTelegramAuth('ops')).toBe('function');
    });
  });
});
