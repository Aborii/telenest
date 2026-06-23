/**
 * @file src/lib/bot/telegram-bot.module-definition.ts
 *
 * PURPOSE
 * -------
 * Builds the `forRoot` / `forRootAsync` plumbing for `TelegramBotModule` using
 * Nest's `ConfigurableModuleBuilder`, and exposes the options injection token.
 *
 * USAGE
 * -----
 * Internal to the Bot API module. Consumers use `TelegramBotModule.forRoot`.
 *
 * KEY EXPORTS
 * -----------
 * - ConfigurableModuleClass: Base class providing forRoot/forRootAsync.
 * - TELEGRAM_BOT_OPTIONS: Token resolving to TelegramBotModuleOptions.
 * - ASYNC_OPTIONS_TYPE / OPTIONS_TYPE: Static option-shape helpers for typing.
 */

import { ConfigurableModuleBuilder } from '@nestjs/common';

import type { TelegramBotModuleOptions } from './telegram-bot.options';
import type { TelegramBotWebhookOptions } from './webhook/telegram-webhook.options';

/**
 * Extra (non-option) settings accepted alongside the module options.
 *
 * These are synchronous and known at `forRoot` / `forRootAsync` call time — even
 * for the async factory — which is why `name` lives here rather than in
 * {@link import('./telegram-bot.options').TelegramBotModuleOptions}: the per-bot
 * DI tokens must be computed up front to build the dynamic module, before any
 * async factory has resolved the token/options.
 */
export interface TelegramBotModuleExtras {
  /** When `true`, the module is registered globally. Defaults to `false`. */
  isGlobal?: boolean;

  /**
   * Registers this bot under a name so multiple bots can coexist in one app.
   * Omit for the single default bot. Inject a named bot's facade with
   * `@InjectBot(name)` and scope its handlers with
   * `@TelegramUpdate({ bot: name })`. Each registered bot must use a distinct name.
   */
  name?: string;

  /**
   * Enables the built-in webhook controller for this bot: a `POST {path}` route
   * that verifies Telegram's secret-token header and feeds updates into the bot.
   * Lives here (an extra) rather than in
   * {@link import('./telegram-bot.options').TelegramBotModuleOptions} because the
   * route `path` must be known synchronously — even for `forRootAsync` — to build
   * the controller, the same reason {@link TelegramBotModuleExtras.name} does.
   * Omit to run in long-polling mode or to mount the webhook callback yourself.
   */
  webhook?: TelegramBotWebhookOptions;
}

/**
 * Generated `forRoot`/`forRootAsync` plumbing. Destructured because
 * `ConfigurableModuleBuilder.build()` returns several related members:
 * - `ConfigurableModuleClass`: base class the module extends.
 * - `TELEGRAM_BOT_OPTIONS` (renamed `MODULE_OPTIONS_TOKEN`): options DI token.
 * - `OPTIONS_TYPE` / `ASYNC_OPTIONS_TYPE`: static option-shape carriers for typing.
 */
export const {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: TELEGRAM_BOT_OPTIONS,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<TelegramBotModuleOptions>()
  .setClassMethodName('forRoot')
  .setExtras<TelegramBotModuleExtras>(
    { isGlobal: false },
    (definition, extras) => ({ ...definition, global: extras.isGlobal }),
  )
  .build();

/** Shape accepted by `TelegramBotModule.forRoot` (options + `isGlobal` + `name`). */
export type TelegramBotModuleForRootOptions = typeof OPTIONS_TYPE;

/**
 * Shape accepted by `TelegramBotModule.forRootAsync` (`useFactory` /
 * `useClass` / `useExisting` + `isGlobal` + `name`). Use it to type a factory
 * provider separately from the call site.
 */
export type TelegramBotModuleAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
