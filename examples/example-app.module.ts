/**
 * @file examples/example-app.module.ts
 *
 * PURPOSE
 * -------
 * A copy-paste reference showing how a consumer wires BOTH sides of the library
 * into a NestJS application using async configuration from `ConfigService`, and
 * how to consume the injected services. This file is illustrative — it is not
 * part of the published package — but it is type-checked so it never goes stale.
 *
 * USAGE
 * -----
 * Adapt `ExampleAppModule` and `ExampleService` into your own app.
 *
 * KEY EXPORTS
 * -----------
 * - ExampleAppModule: Wires TelegramBotModule + TelegramClientModule.
 * - ExampleService: Demonstrates using the bot and user-account services.
 */

import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  FileSessionStore,
  InlineKeyboardBuilder,
  TelegramAuthService,
  TelegramBotModule,
  TelegramBotService,
  TelegramClientModule,
  TelegramUserService,
} from '../src';

/**
 * Demonstrates consuming the injected Telegram services.
 */
@Injectable()
export class ExampleService {
  /**
   * @param bot - Typed Bot API facade (acts as your @BotFather bot).
   * @param user - User-account facade (acts as your own account, via MTProto).
   * @param auth - Login orchestrator for the user-account session.
   */
  public constructor(
    private readonly bot: TelegramBotService,
    private readonly user: TelegramUserService,
    private readonly auth: TelegramAuthService,
  ) {}

  /**
   * Registers a `/start` handler that replies with an inline keyboard.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public registerHandlers(): void {
    this.bot.start(async (ctx) => {
      const keyboard = new InlineKeyboardBuilder()
        .url('Docs', 'https://core.telegram.org/bots/api')
        .callback('Ping', 'ping')
        .build();
      await ctx.reply('Welcome!', { reply_markup: keyboard });
    });

    this.bot.action('ping', async (ctx) => {
      await ctx.answerCbQuery('pong');
    });
  }

  /**
   * Sends a broadcast as the BOT to a chat.
   *
   * @param chatId - Target chat id or `@username`.
   * @param text - Message text.
   * @returns Resolves once sent.
   * @throws {import('../src').TelegramBotApiError} On Bot API failure.
   */
  public async broadcastAsBot(chatId: number | string, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, text);
  }

  /**
   * Sends a note to your own "Saved Messages" as YOUR account (not the bot).
   *
   * @param text - Message text.
   * @returns Resolves once sent.
   * @throws {import('../src').TelegramClientError} If not authorized / on failure.
   */
  public async noteToSelf(text: string): Promise<void> {
    if (!(await this.auth.isAuthorized()))
      throw new Error('Run the login flow first (see examples/login-cli.ts).');
    await this.user.sendToSelf(text);
  }
}

/**
 * Root module wiring both Telegram capabilities from environment configuration.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // ── Bot API (Telegraf): a normal bot. ──────────────────────────────────
    TelegramBotModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('BOT_TOKEN'),
        // launch: false, // disable auto-launch to mount a webhook yourself
      }),
    }),
    // ── MTProto (GramJS): your own account, with persisted session. ────────
    TelegramClientModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        apiId: Number(config.getOrThrow<string>('TG_API_ID')),
        apiHash: config.getOrThrow<string>('TG_API_HASH'),
        sessionStore: new FileSessionStore('./.telegram.session'),
        // Resume from an env-provided session if present:
        session: config.get<string>('TG_SESSION'),
      }),
    }),
  ],
  providers: [ExampleService],
})
export class ExampleAppModule {}
