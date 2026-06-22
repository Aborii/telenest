/**
 * @file src/lib/client/telegram-client.module-definition.ts
 *
 * PURPOSE
 * -------
 * Builds the `forRoot` / `forRootAsync` plumbing for `TelegramClientModule`
 * using Nest's `ConfigurableModuleBuilder`, and exposes the options token.
 *
 * USAGE
 * -----
 * Internal to the MTProto module. Consumers use `TelegramClientModule.forRoot`.
 *
 * KEY EXPORTS
 * -----------
 * - ConfigurableModuleClass: Base class providing forRoot/forRootAsync.
 * - TELEGRAM_CLIENT_OPTIONS: Token resolving to TelegramClientModuleOptions.
 * - OPTIONS_TYPE / ASYNC_OPTIONS_TYPE: Static option-shape helpers for typing.
 * - TelegramClientModuleAsyncOptions: Exported async-options type for factories.
 */

import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { TelegramClientModuleOptions } from './telegram-client.options';

/**
 * Extra (non-option) module settings.
 *
 * These are synchronous and known at `forRoot` / `forRootAsync` call time — even
 * for the async factory — which is why `name` lives here rather than in
 * {@link import('./telegram-client.options').TelegramClientModuleOptions}: the
 * per-account DI tokens must be computed up front to build the dynamic module,
 * before any async factory has resolved the options.
 */
export interface TelegramClientModuleExtras {
  /** When `true`, the module is registered globally. Defaults to `false`. */
  isGlobal?: boolean;

  /**
   * Registers this account under a name so multiple user accounts can coexist in
   * one app. Omit for the single default account. Inject a named account's
   * services with `@InjectTelegramUser(name)` / `@InjectTelegramAuth(name)` and
   * scope its inbound handlers with `@OnUserMessage(filter, { client: name })`.
   * Each registered account must use a distinct name.
   */
  name?: string;
}

/**
 * Generated `forRoot`/`forRootAsync` plumbing. Destructured because
 * `ConfigurableModuleBuilder.build()` returns several related members:
 * - `ConfigurableModuleClass`: base class the module extends.
 * - `TELEGRAM_CLIENT_OPTIONS` (renamed `MODULE_OPTIONS_TOKEN`): options DI token.
 * - `OPTIONS_TYPE` / `ASYNC_OPTIONS_TYPE`: static option-shape carriers for typing.
 */
export const {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: TELEGRAM_CLIENT_OPTIONS,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<TelegramClientModuleOptions>()
  .setClassMethodName('forRoot')
  .setExtras<TelegramClientModuleExtras>(
    { isGlobal: false },
    (definition, extras) => ({ ...definition, global: extras.isGlobal }),
  )
  .build();

/** Shape accepted by `TelegramClientModule.forRoot` (options + `isGlobal` + `name`). */
export type TelegramClientModuleForRootOptions = typeof OPTIONS_TYPE;

/**
 * Shape accepted by `TelegramClientModule.forRootAsync` (`useFactory` /
 * `useClass` / `useExisting` + `isGlobal` + `name`). Use it to type a factory
 * provider separately from the call site.
 */
export type TelegramClientModuleAsyncOptions = typeof ASYNC_OPTIONS_TYPE;
