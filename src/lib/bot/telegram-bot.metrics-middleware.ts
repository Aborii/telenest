/**
 * @file src/lib/bot/telegram-bot.metrics-middleware.ts
 *
 * PURPOSE
 * -------
 * An opt-in Telegraf middleware that increments a bot's `messagesReceived`
 * counter for each inbound update carrying a message. Inbound counting is opt-in
 * (rather than auto-installed) so the library never silently mutates the
 * middleware pipeline — register it yourself, first, to count every update.
 *
 * Outbound counters (`messagesSent`, `apiErrors`, `floodWaits`) are recorded
 * automatically by {@link import('./telegram-bot.service').TelegramBotService};
 * this middleware fills in the inbound side.
 *
 * USAGE
 * -----
 * ```ts
 * import { Inject } from '@nestjs/common';
 * import {
 *   TELEGRAM_BOT_METRICS,
 *   telegramBotMetricsMiddleware,
 *   type TelegramMetricsRecorder,
 * } from 'nestjs-telegram';
 *
 * constructor(
 *   private readonly bot: TelegramBotService,
 *   @Inject(TELEGRAM_BOT_METRICS) metrics: TelegramMetricsRecorder,
 * ) {
 *   // Register before any handlers so every update is counted.
 *   this.bot.use(telegramBotMetricsMiddleware(metrics));
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - telegramBotMetricsMiddleware: builds the inbound-counting Telegraf middleware.
 */

import type { Context, MiddlewareFn } from 'telegraf';

import { TELEGRAM_COUNTERS, type TelegramMetricsRecorder } from '../common';

/**
 * Builds a Telegraf middleware that bumps `messagesReceived` for every inbound
 * update that carries a message, then defers to the rest of the chain.
 *
 * Register it as the **first** middleware (e.g. via `bot.use(...)` or
 * `TelegramBotService.use`) so it observes every update before any handler can
 * short-circuit the chain.
 *
 * @param metrics - The metrics sink to record into (typically resolved from the
 *   `TELEGRAM_BOT_METRICS` token).
 * @returns A Telegraf middleware function.
 * @throws Never (the middleware itself never throws; it always calls `next`).
 *
 * @example
 * ```ts
 * bot.use(telegramBotMetricsMiddleware(metrics));
 * ```
 */
export function telegramBotMetricsMiddleware(
  metrics: TelegramMetricsRecorder,
): MiddlewareFn<Context> {
  return (ctx, next) => {
    if (ctx.message) metrics.increment(TELEGRAM_COUNTERS.MESSAGES_RECEIVED);
    return next();
  };
}
