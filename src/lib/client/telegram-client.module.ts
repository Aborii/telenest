/**
 * @file src/lib/client/telegram-client.module.ts
 *
 * PURPOSE
 * -------
 * Dynamic Nest module for the MTProto (user account) side. It builds and
 * connects an {@link IGramClient}, wires the {@link SessionStore}, and exposes
 * the {@link TelegramAuthService} and {@link TelegramUserService}.
 *
 * USAGE
 * -----
 * ```ts
 * TelegramClientModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     apiId: Number(config.getOrThrow('TG_API_ID')),
 *     apiHash: config.getOrThrow('TG_API_HASH'),
 *     sessionStore: new FileSessionStore('./.telegram.session'),
 *   }),
 *   isGlobal: true,
 * });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramClientModule: The dynamic module with `forRoot` / `forRootAsync`.
 */

import { Module } from '@nestjs/common';
import {
  gramClientProvider,
  sessionStoreProvider,
} from './telegram-client.factory';
import { ConfigurableModuleClass } from './telegram-client.module-definition';
import {
  TELEGRAM_GRAM_CLIENT,
  TELEGRAM_SESSION_STORE,
} from './telegram-client.constants';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramClientLifecycle } from './telegram-client.lifecycle';
import { TelegramUserService } from './telegram-user.service';

/**
 * MTProto feature module. Extends the generated `ConfigurableModuleClass` to
 * inherit fully-typed `forRoot` / `forRootAsync` static factories.
 */
@Module({
  providers: [
    sessionStoreProvider,
    gramClientProvider,
    TelegramClientLifecycle,
    TelegramAuthService,
    TelegramUserService,
  ],
  exports: [
    TELEGRAM_GRAM_CLIENT,
    TELEGRAM_SESSION_STORE,
    TelegramAuthService,
    TelegramUserService,
  ],
})
export class TelegramClientModule extends ConfigurableModuleClass {}
