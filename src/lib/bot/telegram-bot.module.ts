/**
 * @file src/lib/bot/telegram-bot.module.ts
 *
 * PURPOSE
 * -------
 * Dynamic Nest module that wires the Bot API side of the library: it builds a
 * singleton `Telegraf` instance from the supplied options and exposes the typed
 * {@link TelegramBotService} facade.
 *
 * USAGE
 * -----
 * ```ts
 * // Synchronous
 * @Module({ imports: [TelegramBotModule.forRoot({ token: process.env.BOT_TOKEN! })] })
 * export class AppModule {}
 *
 * // Asynchronous (recommended — pulls the token from ConfigService)
 * TelegramBotModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({ token: config.getOrThrow('BOT_TOKEN') }),
 *   isGlobal: true,
 * });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotModule: The dynamic module with `forRoot` / `forRootAsync`.
 */

import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TELEGRAM_BOT } from './telegram-bot.constants';
import { telegramBotProvider } from './telegram-bot.factory';
import { ConfigurableModuleClass } from './telegram-bot.module-definition';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramEnhancerResolver } from './updates/execution/telegram-enhancer.resolver';
import { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';

/**
 * Bot API feature module. Extends the generated `ConfigurableModuleClass` to
 * inherit fully-typed `forRoot` and `forRootAsync` static factories.
 *
 * `DiscoveryModule` + {@link TelegramBotUpdatesRegistrar} power the
 * decorator-based handler system (`@TelegramUpdate`/`@Command`/…): the registrar
 * binds discovered handlers onto the bot at bootstrap, before launch, and runs
 * each through the guards/interceptors/filters resolved by
 * {@link TelegramEnhancerResolver}.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    telegramBotProvider,
    TelegramBotService,
    TelegramEnhancerResolver,
    TelegramBotUpdatesRegistrar,
  ],
  exports: [TelegramBotService, TELEGRAM_BOT],
})
export class TelegramBotModule extends ConfigurableModuleClass {}
