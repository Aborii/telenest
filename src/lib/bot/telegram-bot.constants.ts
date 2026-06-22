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
 * - TELEGRAM_BOT: Token that resolves to the default bot's `Telegraf` instance.
 * - DEFAULT_BOT_NAME: Sentinel name for the unnamed (default) bot registration.
 */

/**
 * Injection token resolving to the raw `Telegraf` instance created by
 * `TelegramBotModule`. Use it when you need low-level access that the typed
 * {@link import('./telegram-bot.service').TelegramBotService} facade does not
 * expose (custom middleware, scenes, the `telegram` Bot API client, etc.).
 *
 * This token is bound to the **default** (unnamed) bot. For a named bot, resolve
 * its raw instance via
 * {@link import('./telegram-bot.tokens').getBotInstanceToken}.
 */
export const TELEGRAM_BOT = Symbol('NESTJS_TELEGRAM_BOT');

/**
 * Sentinel name of the default bot — the one registered by
 * `TelegramBotModule.forRoot()` / `forRootAsync()` when no `name` is supplied.
 *
 * It is the value `@TelegramUpdate()` records when given no `bot`, and the value
 * the token helpers in `./telegram-bot.tokens` treat specially so the default
 * bot keeps its stable, legacy tokens (`TELEGRAM_BOT` and the `TelegramBotService`
 * class) for backward compatibility.
 */
export const DEFAULT_BOT_NAME = 'default';
