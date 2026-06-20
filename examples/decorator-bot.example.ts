/**
 * @file examples/decorator-bot.example.ts
 *
 * PURPOSE
 * -------
 * A copy-paste reference for the Bot API **decorator** system. It shows how to
 * handle updates with `@TelegramUpdate` provider classes — no `nestjs-telegraf`,
 * no reaching for the raw `Telegraf` instance — using the class/method decorators
 * (`@Start`, `@Help`, `@Command`, `@Hears`, `@Action`, `@On`, `@Use`) and the
 * parameter decorators (`@Ctx`, `@MessageText`, `@Sender`, `@CallbackData`).
 *
 * Handlers are ordinary NestJS providers, so constructor DI works exactly as
 * everywhere else (here `GreeterUpdate` injects `GreetingService`). The
 * `TelegramBotUpdatesRegistrar` discovers every `@TelegramUpdate` class at
 * bootstrap and binds its methods onto the bot before launch.
 *
 * This file is illustrative — it is not part of the published package — but it is
 * type-checked (see tsconfig `include`) so it never drifts from the API.
 *
 * USAGE
 * -----
 * Adapt `DecoratorBotExampleModule` into your own app, then `app.listen()` /
 * `app.init()` as usual.
 *
 * KEY EXPORTS
 * -----------
 * - GreetingService: trivial domain service the handler depends on.
 * - GreeterUpdate: the decorated update provider.
 * - DecoratorBotExampleModule: wires TelegramBotModule + the handler.
 */

import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Context } from 'telegraf';
import {
  Action,
  CallbackData,
  Command,
  Ctx,
  Hears,
  Help,
  InlineKeyboardBuilder,
  MessageText,
  On,
  Sender,
  Start,
  TelegramUpdate,
  TelegramBotModule,
  Use,
} from '../src';

/**
 * A trivial domain service, included to demonstrate that decorated handlers are
 * plain providers and participate in normal constructor DI.
 */
@Injectable()
export class GreetingService {
  /**
   * Builds a personalised greeting.
   *
   * @param name - The recipient's first name (falls back to "friend").
   * @returns The greeting line.
   * @throws Never.
   */
  public greet(name: string | undefined): string {
    return `Hello ${name ?? 'friend'}! Try /ping, say "hi", or tap a button.`;
  }
}

/**
 * Update provider: every method is bound onto the bot by the registrar. The
 * class must wear `@TelegramUpdate()` for the registrar to scan it.
 */
@TelegramUpdate()
@Injectable()
export class GreeterUpdate {
  /**
   * @param greetings - Injected domain service (normal NestJS DI).
   */
  public constructor(private readonly greetings: GreetingService) {}

  /**
   * Logs every update first. `@Use()` is global middleware, so it must let the
   * chain continue — the registrar calls `next()` automatically after it.
   *
   * @param ctx - The raw Telegraf context.
   * @returns Nothing.
   * @throws Never.
   */
  @Use()
  public logEveryUpdate(@Ctx() ctx: Context): void {
    // eslint-disable-next-line no-console
    console.log(`update ${ctx.updateType} from ${ctx.from?.id ?? 'unknown'}`);
  }

  /**
   * Greets the user on `/start`, injecting only the sender.
   *
   * @param ctx - The raw Telegraf context (for replying).
   * @param from - The triggering user (`ctx.from`).
   * @returns Resolves once the reply is sent.
   * @throws Never (reply failures propagate to the bot's error handler).
   */
  @Start()
  public async onStart(
    @Ctx() ctx: Context,
    @Sender() from: Context['from'],
  ): Promise<void> {
    await ctx.reply(this.greetings.greet(from?.first_name));
  }

  /**
   * Replies to `/help` with usage.
   *
   * @param ctx - The raw Telegraf context.
   * @returns Resolves once the reply is sent.
   * @throws Never.
   */
  @Help()
  public async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply('Commands: /start, /ping. I also echo your text.');
  }

  /**
   * Answers `/ping` with an inline keyboard to demonstrate callbacks.
   *
   * @param ctx - The raw Telegraf context.
   * @returns Resolves once the reply is sent.
   * @throws Never.
   */
  @Command('ping')
  public async onPing(@Ctx() ctx: Context): Promise<void> {
    const keyboard = new InlineKeyboardBuilder()
      .callback('Pong 🏓', 'pong')
      .build();
    await ctx.reply('pong', { reply_markup: keyboard });
  }

  /**
   * Handles the "Pong" button press, reading the callback data directly.
   *
   * @param ctx - The raw Telegraf context (for answering the query).
   * @param data - The pressed button's callback data.
   * @returns Resolves once the callback is answered.
   * @throws Never.
   */
  @Action('pong')
  public async onPong(
    @Ctx() ctx: Context,
    @CallbackData() data: string | undefined,
  ): Promise<void> {
    await ctx.answerCbQuery(`You pressed: ${data ?? '?'}`);
  }

  /**
   * Replies to common greeting keywords.
   *
   * @param ctx - The raw Telegraf context.
   * @returns Resolves once the reply is sent.
   * @throws Never.
   */
  @Hears(['hi', 'hello', 'hey'])
  public async onGreeting(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply('👋');
  }

  /**
   * Echoes any other text, injecting just the message text (no `ctx` needed for
   * reading — but we still take `ctx` to reply).
   *
   * @param ctx - The raw Telegraf context.
   * @param text - The incoming message text.
   * @returns Resolves once the reply is sent.
   * @throws Never.
   */
  @On('text')
  public async onText(
    @Ctx() ctx: Context,
    @MessageText() text: string | undefined,
  ): Promise<void> {
    if (text && !text.startsWith('/')) await ctx.reply(`Echo: ${text}`);
  }
}

/**
 * Root module: wires the Bot API side and registers the decorated handler.
 * `GreeterUpdate` (and `GreetingService`) are just providers.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TelegramBotModule.forRootAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('BOT_TOKEN'),
      }),
    }),
  ],
  providers: [GreetingService, GreeterUpdate],
})
export class DecoratorBotExampleModule {}
