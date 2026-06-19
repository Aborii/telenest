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

/**
 * Extra (non-option) settings accepted alongside the module options. `isGlobal`
 * registers the module in the global scope so its providers can be injected
 * without re-importing it everywhere.
 */
export interface TelegramBotModuleExtras {
  /** When `true`, the module is registered globally. Defaults to `false`. */
  isGlobal?: boolean;
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

/** Shape accepted by `TelegramBotModule.forRoot` (options + `isGlobal`). */
export type TelegramBotModuleForRootOptions = typeof OPTIONS_TYPE;

/**
 * Shape accepted by `TelegramBotModule.forRootAsync` (`useFactory` /
 * `useClass` / `useExisting` + `isGlobal`). Use it to type a factory provider
 * separately from the call site.
 */
export type TelegramBotModuleAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
