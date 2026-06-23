/**
 * @file src/lib/bot/telegram-bot.health.ts
 *
 * PURPOSE
 * -------
 * A `@nestjs/terminus`-compatible health indicator for the Bot API side. It
 * probes bot reachability with a lightweight `getMe()` call and reports an
 * up/down result in terminus' `HealthIndicatorResult` shape — without importing
 * terminus, so terminus stays an optional peer dependency.
 *
 * Per the library's hard Bot ⟷ MTProto decoupling rule, this indicator covers
 * **only** the Bot API side; the MTProto side ships its own
 * {@link import('../client/telegram-client.health').TelegramClientHealthIndicator}.
 *
 * USAGE
 * -----
 * ```ts
 * @Controller('health')
 * export class HealthController {
 *   constructor(
 *     private readonly health: HealthCheckService,
 *     private readonly botHealth: TelegramBotHealthIndicator,
 *   ) {}
 *
 *   @Get()
 *   @HealthCheck()
 *   check() {
 *     return this.health.check([() => this.botHealth.isHealthy('telegram-bot')]);
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotHealthIndicator: probes bot reachability for a health endpoint.
 */

import { Injectable } from '@nestjs/common';

import { runHealthCheck, type TelegramHealthIndicatorResult } from '../common';
import type { TelegramBotService } from './telegram-bot.service';

/** Default key used for the bot's entry in a health report. */
const DEFAULT_BOT_HEALTH_KEY = 'telegram-bot';

/**
 * Reports whether the Bot API is reachable, for use with `@nestjs/terminus`.
 *
 * The check calls {@link TelegramBotService.getMe}; success yields `up` (with
 * the bot's `id`/`username`), and any failure yields `down` with the error
 * message — the indicator never throws, so a transient outage degrades the
 * health report instead of crashing the endpoint.
 */
@Injectable()
export class TelegramBotHealthIndicator {
  /**
   * @param bot - The Bot API facade to probe.
   */
  public constructor(private readonly bot: TelegramBotService) {}

  /**
   * Probes the Bot API and returns a terminus-compatible health result.
   *
   * @param key - The key for this indicator in the health report. Defaults to
   *   `telegram-bot`.
   * @returns A single-key result: `up` (with `id`/`username`) when `getMe`
   *   succeeds, else `down` with an `error` message.
   * @throws Never.
   *
   * @example
   * ```ts
   * await botHealth.isHealthy(); // { 'telegram-bot': { status: 'up', username: 'my_bot' } }
   * ```
   */
  public isHealthy(
    key: string = DEFAULT_BOT_HEALTH_KEY,
  ): Promise<TelegramHealthIndicatorResult> {
    return runHealthCheck(key, async () => {
      const me = await this.bot.getMe();
      return { id: me.id, username: me.username };
    });
  }
}
