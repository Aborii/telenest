/**
 * @file src/lib/client/telegram-client.health.ts
 *
 * PURPOSE
 * -------
 * A `@nestjs/terminus`-compatible health indicator for the MTProto (user
 * account) side. It reports the account's connection/authorization state in
 * terminus' `HealthIndicatorResult` shape — without importing terminus, so
 * terminus stays an optional peer dependency.
 *
 * Per the library's hard Bot ⟷ MTProto decoupling rule, this indicator covers
 * **only** the MTProto side; the Bot API side ships its own
 * {@link import('../bot/telegram-bot.health').TelegramBotHealthIndicator}.
 *
 * USAGE
 * -----
 * ```ts
 * @Get('health')
 * @HealthCheck()
 * check() {
 *   return this.health.check([() => this.clientHealth.isHealthy('telegram-client')]);
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramClientHealthIndicator: reports MTProto connectivity for a health endpoint.
 */

import { Inject, Injectable } from '@nestjs/common';

import { HEALTH_STATUSES, type TelegramHealthIndicatorResult } from '../common';
import type { IGramClient } from './gram-client.interface';
import { TELEGRAM_GRAM_CLIENT } from './telegram-client.constants';

/** Default key used for the account's entry in a health report. */
const DEFAULT_CLIENT_HEALTH_KEY = 'telegram-client';

/**
 * Reports whether the MTProto account is connected and authorized, for use with
 * `@nestjs/terminus`.
 *
 * The result is `up` only when the client holds an open connection **and** the
 * session is authorized; otherwise it is `down`, with `connected` / `authorized`
 * booleans plus an explanatory `error`. A transport failure while probing is
 * also reported as `down` — the indicator never throws.
 */
@Injectable()
export class TelegramClientHealthIndicator {
  /**
   * @param client - The MTProto client abstraction to probe.
   */
  public constructor(
    @Inject(TELEGRAM_GRAM_CLIENT) private readonly client: IGramClient,
  ) {}

  /**
   * Probes the account's connectivity and returns a terminus-compatible result.
   *
   * @param key - The key for this indicator in the health report. Defaults to
   *   `telegram-client`.
   * @returns A single-key result: `up` with `connected`/`authorized` when both
   *   hold, else `down` with the same booleans and an `error` message.
   * @throws Never.
   *
   * @example
   * ```ts
   * await clientHealth.isHealthy();
   * // { 'telegram-client': { status: 'up', connected: true, authorized: true } }
   * ```
   */
  public async isHealthy(
    key: string = DEFAULT_CLIENT_HEALTH_KEY,
  ): Promise<TelegramHealthIndicatorResult> {
    // ── `isConnected()` is synchronous and never throws, so read it up front:
    //    that way the catch below still reports the true connection state even
    //    when only the async `isAuthorized()` probe fails. ────────────────────
    const connected = this.client.isConnected();
    try {
      // ── Only probe authorization when connected; a disconnected client can
      //    throw on `isAuthorized`, which the catch below would report anyway. ─
      const authorized = connected ? await this.client.isAuthorized() : false;
      const up = connected && authorized;
      const error = !connected
        ? 'client is not connected'
        : !authorized
          ? 'session is not authorized'
          : undefined;
      return {
        [key]: {
          status: up ? HEALTH_STATUSES.UP : HEALTH_STATUSES.DOWN,
          connected,
          authorized,
          error,
        },
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return {
        [key]: {
          status: HEALTH_STATUSES.DOWN,
          connected,
          authorized: false,
          error: message,
        },
      };
    }
  }
}
