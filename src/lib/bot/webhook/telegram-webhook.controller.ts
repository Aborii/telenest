/**
 * @file src/lib/bot/webhook/telegram-webhook.controller.ts
 *
 * PURPOSE
 * -------
 * Factory that builds the dynamic webhook controller for one bot registration.
 * The HTTP route is configurable (and, for `forRootAsync`, not known until call
 * time), and Nest bakes a controller's path into class metadata — so the class
 * is generated *per registration* with `@Controller(path)` applied, rather than
 * declared statically. Each generated controller feeds incoming updates into its
 * bot via `Telegraf.handleUpdate` and is protected by the secret-token guard.
 *
 * USAGE
 * -----
 * Internal to `TelegramBotModule`; one controller is added to the dynamic module
 * per registration that enables the webhook.
 *
 * KEY EXPORTS
 * -----------
 * - createTelegramWebhookController: Builds a path-bound webhook controller class.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
  type Type,
} from '@nestjs/common';
import type { Telegraf } from 'telegraf';

import { TELEGRAM_WEBHOOK_BOT } from './telegram-webhook.constants';
import { TelegramWebhookGuard } from './telegram-webhook.guard';

/**
 * Builds a controller class that handles `POST {path}` webhook deliveries for one
 * bot. A fresh class is returned on every call so that multiple bots get
 * independent controllers (distinct paths, distinct metadata); the bot instance
 * is injected through the per-module {@link TELEGRAM_WEBHOOK_BOT} alias, so the
 * same factory serves both the default and named bots.
 *
 * @param path - The HTTP route the controller listens on (e.g.
 *   `/telegram/webhook`). Baked into the `@Controller` metadata.
 * @returns A Nest controller class ready to add to a dynamic module's
 *   `controllers` array.
 * @throws Never.
 *
 * @example
 * ```ts
 * const controller = createTelegramWebhookController('/telegram/webhook');
 * // -> add to DynamicModule.controllers
 * ```
 */
export function createTelegramWebhookController(path: string): Type<unknown> {
  /**
   * Webhook endpoint for a single bot. The secret-token guard runs first; a
   * delivery that passes is dispatched to the bot's middleware/handlers and
   * acknowledged with `200 OK` (Telegram treats any 2xx as "delivered").
   */
  @Controller(path)
  @UseGuards(TelegramWebhookGuard)
  class TelegramWebhookController {
    /**
     * @param _bot - This bot's raw `Telegraf` instance (per-module alias).
     */
    public constructor(
      @Inject(TELEGRAM_WEBHOOK_BOT) private readonly _bot: Telegraf,
    ) {}

    /**
     * Feeds one incoming Telegram update into the bot.
     *
     * @param update - The update payload sent by Telegram (the parsed JSON body).
     * @returns A promise that resolves once the update has been dispatched.
     * @throws Whatever `Telegraf.handleUpdate` propagates (surfaced by Nest as a
     *   `500`, prompting Telegram to redeliver). Telegraf's own error handler
     *   normally absorbs handler errors before they reach here.
     */
    @Post()
    @HttpCode(HttpStatus.OK)
    public async handleUpdate(
      @Body() update: Parameters<Telegraf['handleUpdate']>[0],
    ): Promise<void> {
      await this._bot.handleUpdate(update);
    }
  }

  return TelegramWebhookController;
}
