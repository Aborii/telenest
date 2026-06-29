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
 * - normalizeWebhookPath: Canonicalizes a route path (leading slash, no trailing).
 * - joinWebhookUrl: Joins a domain and path into the URL passed to `setWebhook`.
 * - assertValidWebhookOptions: Throws `TelegramConfigError` on bad webhook config.
 */

import { TelegramConfigError } from '../../common';
import type { TelegramBotWebhookOptions } from './telegram-webhook.options';

/**
 * Telegram's allowed `secret_token` shape: 1–256 characters of `A-Z a-z 0-9 _ -`.
 * Mirrors the Bot API docs for `setWebhook`'s `secret_token` parameter.
 */
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Canonicalizes a webhook route path so the controller route mounted by Nest and
 * the URL registered with Telegram (`setWebhook`) are derived identically and can
 * never diverge. Trims surrounding whitespace, collapses duplicate slashes,
 * ensures exactly one leading slash, and drops any trailing slash(es).
 *
 * @param path - The raw `webhook.path` from the options.
 * @returns The canonical path, e.g. `'telegram//webhook/'` → `'/telegram/webhook'`;
 *   an empty or `'/'`-only path normalizes to `'/'`.
 * @throws Never.
 *
 * @example
 * ```ts
 * normalizeWebhookPath('telegram/webhook/'); // -> '/telegram/webhook'
 * ```
 */
export function normalizeWebhookPath(path: string): string {
  // ── Split on '/' and drop empty segments. This collapses duplicate slashes
  //    and trims leading/trailing ones in a single linear pass — no
  //    backtracking regex (avoids the `\/+$` polynomial-ReDoS shape). ─────────
  const segments = path
    .trim()
    .split('/')
    .filter((segment) => segment !== '');
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Joins a domain origin and a route path into a single absolute webhook URL.
 *
 * The `path` is run through {@link normalizeWebhookPath}, and a trailing slash on
 * `domain` is stripped, so `('https://x.com/', 'hook/')` and
 * `('https://x.com', '/hook')` each yield `https://x.com/hook` — the exact route
 * the controller mounts. Any base path already present on `domain` is preserved
 * (unlike `new URL(path, domain)`, which would discard it).
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
  // ── Strip trailing slashes without a backtracking `\/+$` regex: walk back
  //    from the end in a single linear pass. ──────────────────────────────────
  let end = domain.length;
  while (end > 0 && domain.charCodeAt(end - 1) === 0x2f /* '/' */) end -= 1;
  const base = domain.slice(0, end);
  return `${base}${normalizeWebhookPath(path)}`;
}

/**
 * Validates a {@link TelegramBotWebhookOptions} object at registration time so a
 * misconfiguration surfaces immediately, with an actionable message, instead of
 * as a confusing routing or `setWebhook` failure later.
 *
 * Rules enforced:
 * - `path` must be a non-empty (non-blank) string with no internal whitespace
 *   (it is canonicalized via {@link normalizeWebhookPath} for routing).
 * - A `secretToken` is required unless `allowInsecure` is `true` (so an
 *   unauthenticated webhook is never stood up by accident); when present it must
 *   match Telegram's `secret_token` shape (1–256 chars of `A-Z a-z 0-9 _ -`).
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
  if (typeof options.path !== 'string' || options.path.trim().length === 0)
    throw new TelegramConfigError(
      'TelegramBotModule webhook requires a non-empty "path".',
    );

  // ── Internal whitespace can't be normalized away and would split the route
  //    from the registered URL; reject it outright. ──────────────────────────
  if (/\s/.test(options.path.trim()))
    throw new TelegramConfigError(
      'TelegramBotModule webhook "path" must not contain whitespace.',
    );

  // ── Fail closed: a route with no secret is unauthenticated. Require either a
  //    valid secretToken or an explicit allowInsecure opt-in. ─────────────────
  if (
    typeof options.secretToken === 'string' &&
    options.secretToken.length > 0
  ) {
    if (!WEBHOOK_SECRET_PATTERN.test(options.secretToken))
      throw new TelegramConfigError(
        'TelegramBotModule webhook "secretToken" must be 1-256 characters of ' +
          "A-Z, a-z, 0-9, underscore, or hyphen (Telegram's secret_token rule).",
      );
  } else if (options.allowInsecure !== true)
    throw new TelegramConfigError(
      'TelegramBotModule webhook requires a "secretToken" (use generateWebhookSecret() ' +
        'to mint one) so incoming updates are authenticated. To deliberately run an ' +
        'unauthenticated route, set "allowInsecure: true".',
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
