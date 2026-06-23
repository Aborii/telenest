/**
 * @file src/lib/bot/telegram-bot.factory.ts
 *
 * PURPOSE
 * -------
 * Pure factory that constructs a `Telegraf` instance from validated module
 * options. Isolating construction here keeps the module file declarative, gives
 * tests a single seam to stub the bot, and lets `TelegramBotModule` build one
 * instance per registered (named) bot from the same code path.
 *
 * USAGE
 * -----
 * Internal to `TelegramBotModule` (used by its per-bot instance providers).
 *
 * KEY EXPORTS
 * -----------
 * - createTelegrafInstance: Pure factory used by the per-bot DI providers.
 */

import { Telegraf } from 'telegraf';

import { TelegramConfigError } from '../common';
import type { TelegramBotModuleOptions } from './telegram-bot.options';

/**
 * Validates options and builds a `Telegraf` instance.
 *
 * @param options - Validated module options.
 * @returns A constructed (but not yet launched) `Telegraf` instance.
 * @throws {TelegramConfigError} If the bot token is missing or blank.
 *
 * @example
 * ```ts
 * const bot = createTelegrafInstance({ token: '123:abc' });
 * ```
 */
export function createTelegrafInstance(
  options: TelegramBotModuleOptions,
): Telegraf {
  // ── Fail fast on misconfiguration so the error is actionable at bootstrap
  //    instead of surfacing as a 401 on the first API call. ─────────────────
  if (!options.token || options.token.trim().length === 0)
    throw new TelegramConfigError(
      'TelegramBotModule requires a non-empty "token".',
    );

  return new Telegraf(options.token, options.telegraf);
}
