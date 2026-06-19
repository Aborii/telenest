/**
 * @file src/app.module.ts
 *
 * PURPOSE
 * -------
 * Root application module that wires configuration and two Telegraf bots.
 *
 * USAGE
 * -----
 * Imported by src/main.ts during bootstrap.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BOT_NAMES } from './app.constants';
import { EchoModule } from './bots/echo/echo.module';
import { GreeterModule } from './bots/greeter/greeter.module';
import { greeterSessionMiddleware } from './bots/greeter/middleware/session.middleware';
import { buildLaunchOptions } from './common/config/env.config';
import {
  AppEnvironment,
  validateEnvironment,
} from './common/config/env.validation';

/**
 * Composes root infrastructure and bot-specific modules.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    TelegrafModule.forRootAsync({
      botName: BOT_NAMES.ECHO,
      imports: [ConfigModule, EchoModule],
      useFactory: (configService: ConfigService<AppEnvironment>) => ({
        token: configService.getOrThrow<string>('ECHO_BOT_TOKEN'),
        launchOptions: buildLaunchOptions(
          configService.get<string>('ECHO_BOT_WEBHOOK_DOMAIN'),
          configService.get<string>('ECHO_BOT_WEBHOOK_PATH'),
        ),
        include: [EchoModule],
      }),
      inject: [ConfigService],
    }),
    TelegrafModule.forRootAsync({
      botName: BOT_NAMES.GREETER,
      imports: [ConfigModule, GreeterModule],
      useFactory: (configService: ConfigService<AppEnvironment>) => ({
        token: configService.getOrThrow<string>('GREETER_BOT_TOKEN'),
        launchOptions: buildLaunchOptions(
          configService.get<string>('GREETER_BOT_WEBHOOK_DOMAIN'),
          configService.get<string>('GREETER_BOT_WEBHOOK_PATH'),
        ),
        middlewares: [greeterSessionMiddleware],
        include: [GreeterModule],
      }),
      inject: [ConfigService],
    }),
    EchoModule,
    GreeterModule,
  ],
})
export class AppModule {}
