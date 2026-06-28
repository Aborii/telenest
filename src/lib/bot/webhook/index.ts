/**
 * @file src/lib/bot/webhook/index.ts
 *
 * PURPOSE
 * -------
 * Public barrel for the built-in webhook controller. Re-exports the options
 * type, the reusable secret-token guard, the secret-token header constant, and
 * the secret-token generator. The controller factory and bootstrap registrar are
 * internal wiring and are not re-exported here.
 *
 * USAGE
 * -----
 * import { TelegramBotWebhookOptions, TelegramWebhookGuard, generateWebhookSecret } from 'telenest';
 */

export { TELEGRAM_WEBHOOK_SECRET_HEADER } from './telegram-webhook.constants';
export { generateWebhookSecret } from './secret-token';
export { TelegramWebhookGuard } from './telegram-webhook.guard';
export * from './telegram-webhook.options';
