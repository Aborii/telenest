/**
 * @file src/lib/bot/telegram-bot.constants.ts
 *
 * PURPOSE
 * -------
 * Dependency-injection tokens for the Bot API side of the library.
 *
 * USAGE
 * -----
 * ```ts
 * import { Inject } from '@nestjs/common';
 * import { TELEGRAM_BOT } from 'nestjs-telegram';
 * import { Telegraf } from 'telegraf';
 *
 * constructor(@Inject(TELEGRAM_BOT) private readonly bot: Telegraf) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_BOT: Token that resolves to the underlying `Telegraf` instance.
 */

/**
 * Injection token resolving to the raw `Telegraf` instance created by
 * `TelegramBotModule`. Use it when you need low-level access that the typed
 * {@link import('./telegram-bot.service').TelegramBotService} facade does not
 * expose (custom middleware, scenes, the `telegram` Bot API client, etc.).
 */
export const TELEGRAM_BOT = Symbol('NESTJS_TELEGRAM_BOT');
