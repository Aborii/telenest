/**
 * @file src/lib/telegram.module.ts
 *
 * PURPOSE
 * -------
 * Convenience umbrella module that composes the Bot API and MTProto modules in
 * a single `forRoot` call. Use it when you want both capabilities configured
 * synchronously from one options object. For configuration that depends on
 * `ConfigService` (or any other provider), import {@link TelegramBotModule} and
 * {@link TelegramClientModule} directly and use their `forRootAsync` factories.
 *
 * USAGE
 * -----
 * ```ts
 * @Module({
 *   imports: [
 *     TelegramModule.forRoot({
 *       isGlobal: true,
 *       bot: { token: process.env.BOT_TOKEN! },
 *       client: {
 *         apiId: Number(process.env.TG_API_ID),
 *         apiHash: process.env.TG_API_HASH!,
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramModule: Umbrella module with a composed `forRoot`.
 * - TelegramModuleOptions: Combined options for both sub-modules.
 */

import { Module, type DynamicModule } from '@nestjs/common';

import { TelegramBotModule } from './bot/telegram-bot.module';
import type { TelegramBotModuleOptions } from './bot/telegram-bot.options';
import { TelegramClientModule } from './client/telegram-client.module';
import type { TelegramClientModuleOptions } from './client/telegram-client.options';

/** Combined options for {@link TelegramModule.forRoot}. */
export interface TelegramModuleOptions {
  /** Bot API configuration. Omit to skip registering the Bot API module. */
  bot?: TelegramBotModuleOptions;
  /** MTProto configuration. Omit to skip registering the user-account module. */
  client?: TelegramClientModuleOptions;
  /** Register both sub-modules globally. Defaults to `false`. */
  isGlobal?: boolean;
}

/**
 * Umbrella module composing the Bot API and MTProto sub-modules. At least one
 * of `bot` / `client` should be provided; supplying neither yields an empty
 * module (useful as a no-op in feature-flagged configurations).
 */
@Module({})
export class TelegramModule {
  /**
   * Registers the requested sub-modules synchronously.
   *
   * @param options - Combined bot/client options and the global flag.
   * @returns A dynamic module importing and re-exporting the chosen sub-modules.
   * @throws {import('./common').TelegramConfigError} If a sub-module's options
   *   are invalid (e.g. an empty bot token), raised lazily at provider
   *   construction.
   */
  public static forRoot(options: TelegramModuleOptions): DynamicModule {
    const isGlobal = options.isGlobal ?? false;
    const imports: DynamicModule[] = [];

    if (options.bot)
      imports.push(TelegramBotModule.forRoot({ ...options.bot, isGlobal }));

    if (options.client)
      imports.push(
        TelegramClientModule.forRoot({ ...options.client, isGlobal }),
      );

    return {
      module: TelegramModule,
      global: isGlobal,
      imports,
      exports: imports,
    };
  }
}
