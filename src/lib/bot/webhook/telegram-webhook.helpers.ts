/**
 * @file src/lib/bot/webhook/telegram-webhook.helpers.ts
 *
 * PURPOSE
 * -------
 * Pure helpers for the webhook controller: building the public webhook URL and
 * fail-fast validation of the webhook options. Kept side-effect free so they can
 * be unit-tested in isolation and reused by both the module wiring (validation,
 * at registration time) and the bootstrap registrar (URL, at `setWebhook` time).
 *
 * USAGE
 * -----
 * Internal to the webhook module wiring and registrar.
 *
 * KEY EXPORTS
 * -----------
 * - joinWebhookUrl: Joins a domain and path into the URL passed to `setWebhook`.
 * - assertValidWebhookOptions: Throws `TelegramConfigError` on bad webhook config.
 */

import { TelegramConfigError } from '../../common';
import type { TelegramBotWebhookOptions } from './telegram-webhook.options';

/**
 * Joins a domain origin and a route path into a single absolute webhook URL.
 *
 * A trailing slash on `domain` and a missing leading slash on `path` are both
 * tolerated, so `('https://x.com/', 'hook')` and `('https://x.com', '/hook')`
 * each yield `https://x.com/hook`. Any base path already present on `domain` is
 * preserved (unlike `new URL(path, domain)`, which would discard it).
 *
 * @param domain - The public origin, e.g. `https://bot.example.com`.
 * @param path - The controller route path, e.g. `/telegram/webhook`.
 * @returns The combined absolute URL.
 * @throws Never.
 *
 * @example
 * ```ts
 * joinWebhookUrl('https://bot.example.com', '/telegram/webhook');
 * // -> 'https://bot.example.com/telegram/webhook'
 * ```
 */
export function joinWebhookUrl(domain: string, path: string): string {
  const base = domain.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Validates a {@link TelegramBotWebhookOptions} object at registration time so a
 * misconfiguration surfaces immediately, with an actionable message, instead of
 * as a confusing routing or `setWebhook` failure later.
 *
 * Rules enforced:
 * - `path` must be a non-empty (non-blank) string.
 * - When `registerOnBootstrap` is `true`, `domain` is required and must parse as
 *   an absolute `http(s)` URL (Telegram only delivers to HTTPS in production).
 *
 * @param options - The webhook options supplied to `forRoot` / `forRootAsync`.
 * @returns Nothing.
 * @throws {TelegramConfigError} If any rule above is violated.
 */
export function assertValidWebhookOptions(
  options: TelegramBotWebhookOptions,
): void {
  if (
    typeof options.path !== 'string' ||
    options.path.trim().length === 0
  )
    throw new TelegramConfigError(
      'TelegramBotModule webhook requires a non-empty "path".',
    );

  if (options.registerOnBootstrap) {
    if (!options.domain || options.domain.trim().length === 0)
      throw new TelegramConfigError(
        'TelegramBotModule webhook "registerOnBootstrap" requires a "domain".',
      );

    let parsed: URL;
    try {
      parsed = new URL(options.domain);
    } catch {
      throw new TelegramConfigError(
        `TelegramBotModule webhook "domain" is not a valid URL: ${options.domain}`,
      );
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      throw new TelegramConfigError(
        `TelegramBotModule webhook "domain" must be an http(s) URL: ${options.domain}`,
      );
  }
}
