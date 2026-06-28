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
 * import { TELEGRAM_BOT } from 'telenest';
 * import { Telegraf } from 'telegraf';
 *
 * constructor(@Inject(TELEGRAM_BOT) private readonly bot: Telegraf) {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_BOT: Token that resolves to the default bot's `Telegraf` instance.
 * - TELEGRAM_BOT_METRICS: Token resolving to the default bot's metrics surface.
 * - TELEGRAM_BOT_TRACER: Token resolving to the default bot's tracer.
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
 * Injection token resolving to the **default** bot's
 * {@link import('../common').TelegramMetrics} surface (an
 * {@link import('../common').InMemoryTelegramMetrics} by default). Inject it to
 * read counters (`messagesSent`, `apiErrors`, …) via `.snapshot()`, or override
 * the provider to bridge to your own metrics backend. For a named bot, resolve
 * its metrics via {@link import('./telegram-bot.tokens').getBotMetricsToken}.
 */
export const TELEGRAM_BOT_METRICS = Symbol('NESTJS_TELEGRAM_BOT_METRICS');

/**
 * Injection token resolving to the **default** bot's
 * {@link import('../common').TelegramTracer}. Defaults to a no-op tracer;
 * override the provider with
 * {@link import('../common').createOpenTelemetryTracer} to emit OpenTelemetry
 * spans around every Bot API call. For a named bot, resolve its tracer via
 * {@link import('./telegram-bot.tokens').getBotTracerToken}.
 */
export const TELEGRAM_BOT_TRACER = Symbol('NESTJS_TELEGRAM_BOT_TRACER');

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
