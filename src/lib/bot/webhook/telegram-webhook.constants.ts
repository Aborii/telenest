/**
 * @file src/lib/bot/webhook/telegram-webhook.constants.ts
 *
 * PURPOSE
 * -------
 * Dependency-injection tokens and HTTP constants for the built-in webhook
 * controller. The two DI tokens are *per-registration aliases*: each
 * `TelegramBotModule.forRoot({ webhook })` registration binds them inside its own
 * isolated module scope, so multiple named bots never collide on them.
 *
 * USAGE
 * -----
 * Internal to the webhook controller, guard, and registrar.
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_WEBHOOK_SECRET_HEADER: Lower-cased Telegram secret-token header name.
 * - TELEGRAM_WEBHOOK_OPTIONS: Token resolving to this bot's webhook options.
 * - TELEGRAM_WEBHOOK_BOT: Token aliasing this bot's raw `Telegraf` instance.
 */

/**
 * Name of the HTTP header Telegram sends on every webhook delivery, carrying the
 * configured secret token. Stored lower-cased because Node's HTTP layer
 * normalizes incoming header names to lower-case (so `req.headers[...]` lookups
 * must use this exact casing). See
 * {@link https://core.telegram.org/bots/api#setwebhook}.
 */
export const TELEGRAM_WEBHOOK_SECRET_HEADER =
  'x-telegram-bot-api-secret-token' as const;

/**
 * Injection token resolving to this registration's
 * {@link import('./telegram-webhook.options').TelegramBotWebhookOptions}. Bound
 * as a value provider inside each module that enables the webhook, so the guard
 * and registrar read the options for *their* bot.
 */
export const TELEGRAM_WEBHOOK_OPTIONS = Symbol(
  'NESTJS_TELEGRAM_WEBHOOK_OPTIONS',
);

/**
 * Injection token aliasing this registration's raw `Telegraf` instance. Bound
 * via `useExisting` to the bot's real instance token (`TELEGRAM_BOT` for the
 * default bot, or the name-derived token for a named bot), giving the webhook
 * controller/registrar a single stable token to inject regardless of bot name.
 */
export const TELEGRAM_WEBHOOK_BOT = Symbol('NESTJS_TELEGRAM_WEBHOOK_BOT');
