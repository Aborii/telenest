/**
 * @file src/lib/bot/telegram-bot.factory.ts
 *
 * PURPOSE
 * -------
 * Factory provider that constructs the singleton `Telegraf` instance from the
 * validated module options. Isolating construction here keeps the module file
 * declarative and gives tests a single seam to stub the bot.
 *
 * USAGE
 * -----
 * Internal to `TelegramBotModule`.
 *
 * KEY EXPORTS
 * -----------
 * - createTelegrafInstance: Pure factory used by the DI provider.
 * - telegramBotProvider: The Nest provider wiring it to `TELEGRAM_BOT`.
 */

import type { Provider } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { TelegramConfigError } from '../common';
import { TELEGRAM_BOT } from './telegram-bot.constants';
import { TELEGRAM_BOT_OPTIONS } from './telegram-bot.module-definition';
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

/**
 * Nest provider that exposes the `Telegraf` instance under {@link TELEGRAM_BOT}.
 */
export const telegramBotProvider: Provider = {
  provide: TELEGRAM_BOT,
  useFactory: (options: TelegramBotModuleOptions): Telegraf =>
    createTelegrafInstance(options),
  inject: [TELEGRAM_BOT_OPTIONS],
};
