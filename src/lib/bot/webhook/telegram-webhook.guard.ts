/**
 * @file src/lib/bot/webhook/telegram-webhook.guard.ts
 *
 * PURPOSE
 * -------
 * Nest guard that authenticates incoming webhook requests by verifying
 * Telegram's `X-Telegram-Bot-Api-Secret-Token` header against the secret
 * configured for the bot. The comparison is constant-time (see
 * {@link import('./secret-token').timingSafeEqualSecret}) so the secret cannot be
 * recovered through timing.
 *
 * USAGE
 * -----
 * Applied automatically (via `@UseGuards`) to the generated webhook controller;
 * also exported so consumers can reuse it on their own routes if desired.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramWebhookGuard: CanActivate guard enforcing the secret-token header.
 */

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { timingSafeEqualSecret } from './secret-token';
import {
  TELEGRAM_WEBHOOK_OPTIONS,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
} from './telegram-webhook.constants';
import type { TelegramBotWebhookOptions } from './telegram-webhook.options';

/**
 * Minimal shape of the HTTP request this guard reads — just its headers. Typed
 * explicitly (rather than `any`) so header access stays sound across the Express
 * and Fastify adapters, both of which expose lower-cased header keys here.
 */
interface RequestWithHeaders {
  /** Lower-cased request headers; a repeated header may arrive as `string[]`. */
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * Guard that rejects webhook deliveries whose secret token is missing or wrong.
 *
 * When no `secretToken` is configured the guard allows the request (verification
 * is impossible) — the {@link import('./telegram-webhook.registrar').TelegramWebhookRegistrar}
 * logs a warning at bootstrap in that case so the open endpoint is not silent.
 */
@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  /** Logger; child name keeps rejection lines attributable. */
  private readonly _logger = new Logger(TelegramWebhookGuard.name);

  /**
   * @param _options - This bot's webhook options, supplied per-registration.
   */
  public constructor(
    @Inject(TELEGRAM_WEBHOOK_OPTIONS)
    private readonly _options: TelegramBotWebhookOptions,
  ) {}

  /**
   * Authorizes the request iff the configured secret token matches the header
   * (or no secret is configured).
   *
   * @param context - The Nest execution context for the incoming request.
   * @returns `true` when the request is allowed through.
   * @throws {ForbiddenException} When a secret is configured but the request's
   *   token header is absent or does not match.
   */
  public canActivate(context: ExecutionContext): boolean {
    const expected = this._options.secretToken;

    // ── No secret configured → cannot verify; allow (warned at bootstrap). ─────
    if (!expected) return true;

    const request = context
      .switchToHttp()
      .getRequest<RequestWithHeaders>();
    const raw = request.headers[TELEGRAM_WEBHOOK_SECRET_HEADER];
    // ── A duplicated header arrives as an array; take the first value. ─────────
    const received = Array.isArray(raw) ? raw[0] : raw;

    if (!timingSafeEqualSecret(expected, received)) {
      this._logger.warn(
        'Rejected webhook request: missing or invalid secret token.',
      );
      throw new ForbiddenException('Invalid Telegram webhook secret token.');
    }

    return true;
  }
}
