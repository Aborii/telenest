/**
 * @file src/lib/bot/webhook/telegram-webhook.registrar.ts
 *
 * PURPOSE
 * -------
 * Bootstrap-time helper for the webhook controller. When the bot is configured
 * with `webhook.registerOnBootstrap`, this provider calls `setWebhook` on
 * application bootstrap so Telegram starts delivering updates to the controller's
 * route — with the configured secret token attached. It also warns when a
 * webhook route is enabled without a secret token (an unauthenticated endpoint).
 *
 * USAGE
 * -----
 * Internal to `TelegramBotModule`; added to the providers of any registration
 * that enables the webhook so its `onApplicationBootstrap` hook fires.
 *
 * KEY EXPORTS
 * -----------
 * - TelegramWebhookRegistrar: Bootstrap provider that registers the webhook.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Telegraf } from 'telegraf';

import {
  TELEGRAM_WEBHOOK_BOT,
  TELEGRAM_WEBHOOK_OPTIONS,
} from './telegram-webhook.constants';
import { joinWebhookUrl } from './telegram-webhook.helpers';
import type { TelegramBotWebhookOptions } from './telegram-webhook.options';

/**
 * Registers the bot's webhook with Telegram on bootstrap (opt-in) and surfaces a
 * warning when the webhook route has no secret token.
 *
 * Note: when running in webhook mode you should also set the module's
 * `launch: false`, otherwise {@link import('../telegram-bot.service').TelegramBotService}
 * will additionally start long-polling, which conflicts with webhook delivery.
 */
@Injectable()
export class TelegramWebhookRegistrar implements OnApplicationBootstrap {
  /** Logger; child name keeps registration lines attributable. */
  private readonly _logger = new Logger(TelegramWebhookRegistrar.name);

  /**
   * @param _bot - This bot's raw `Telegraf` instance (per-module alias).
   * @param _options - This bot's webhook options, supplied per-registration.
   */
  public constructor(
    @Inject(TELEGRAM_WEBHOOK_BOT) private readonly _bot: Telegraf,
    @Inject(TELEGRAM_WEBHOOK_OPTIONS)
    private readonly _options: TelegramBotWebhookOptions,
  ) {}

  /**
   * On bootstrap, warns about an unauthenticated route and (when opted in)
   * registers the webhook URL with Telegram.
   *
   * A failed `setWebhook` is logged rather than rethrown, so a transient
   * Telegram/network error does not abort the host application's startup — the
   * same non-fatal policy {@link import('../telegram-bot.service').TelegramBotService}
   * applies to `launch`.
   *
   * @returns A promise that resolves once registration has been attempted.
   * @throws Never.
   */
  public async onApplicationBootstrap(): Promise<void> {
    if (!this._options.secretToken)
      this._logger.warn(
        `Webhook route "${this._options.path}" has no secretToken; ` +
          'incoming updates are NOT authenticated.',
      );

    if (!this._options.registerOnBootstrap) return;

    // ── `domain` is guaranteed present here: assertValidWebhookOptions, run at
    //    registration, rejects `registerOnBootstrap` without a valid domain. The
    //    assertion narrows away the optional type without a runtime branch. ─────
    const url = joinWebhookUrl(
      this._options.domain as string,
      this._options.path,
    );
    try {
      await this._bot.telegram.setWebhook(url, {
        secret_token: this._options.secretToken,
      });
      this._logger.log(`Registered Telegram webhook at ${url}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._logger.error(`Failed to register webhook at ${url}: ${message}`);
    }
  }
}
