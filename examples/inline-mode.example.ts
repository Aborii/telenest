/**
 * @file examples/inline-mode.example.ts
 *
 * PURPOSE
 * -------
 * A copy-paste reference for Telegram **inline mode** — a bot invoked via
 * `@botname query` from any chat. It shows the first-class decorators
 * (`@InlineQuery`, `@ChosenInlineResult`), the inline-query parameter decorators
 * (`@InlineQueryText`, `@InlineQueryOffset`), the fluent
 * `InlineQueryResultBuilder`, and answering via `ctx.answerInlineQuery`.
 *
 * Inline mode must first be enabled for the bot via @BotFather (`/setinline`);
 * `chosen_inline_result` updates additionally require inline feedback
 * (`/setinlinefeedback`).
 *
 * This file is illustrative — it is not part of the published package — but it is
 * type-checked (see tsconfig `include`) so it never drifts from the API.
 *
 * USAGE
 * -----
 * Adapt `InlineModeExampleModule` into your own app, then `app.init()` as usual.
 *
 * KEY EXPORTS
 * -----------
 * - InlineSearchUpdate: the decorated inline-mode update provider.
 * - InlineModeExampleModule: wires TelegramBotModule + the handler.
 */

import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Context } from 'telegraf';

import {
  ChosenInlineResult,
  Ctx,
  InlineQuery,
  InlineQueryOffset,
  InlineQueryResultBuilder,
  InlineQueryText,
  TelegramBotModule,
  TelegramUpdate,
} from '../src';

/**
 * Update provider handling inline queries. Every method is bound onto the bot by
 * the registrar; the class must wear `@TelegramUpdate()` to be scanned.
 */
@TelegramUpdate()
@Injectable()
export class InlineSearchUpdate {
  /**
   * Answers a `weather …` inline query with a single article result. The
   * pattern restricts this handler to queries starting with "weather".
   *
   * @param ctx - The raw Telegraf context (for answering the query).
   * @param text - The full inline query text (e.g. "weather London").
   * @param offset - The pagination offset (empty for the first page).
   * @returns Resolves once the query is answered.
   * @throws Never (answer failures propagate to the bot's error handler).
   */
  @InlineQuery(/^weather/)
  public async onWeather(
    @Ctx() ctx: Context,
    @InlineQueryText() text: string | undefined,
    @InlineQueryOffset() offset: string | undefined,
  ): Promise<void> {
    const city = (text ?? '').replace(/^weather\s*/i, '').trim() || 'your city';
    const results = new InlineQueryResultBuilder()
      .article({
        title: `Weather in ${city}`,
        description: `Offset: ${offset || '0'}`,
        input_message_content: InlineQueryResultBuilder.text(
          `The weather in ${city} is lovely. ☀️`,
        ),
      })
      .build();

    // ── cache_time: 0 keeps results fresh while developing. ───────────────────
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  }

  /**
   * Fallback for every other inline query: echoes the text back as an article.
   * A bare `@InlineQuery()` matches all queries, so declare it after the more
   * specific handlers.
   *
   * @param ctx - The raw Telegraf context.
   * @param text - The inline query text.
   * @returns Resolves once the query is answered.
   * @throws Never.
   */
  @InlineQuery()
  public async onAnyQuery(
    @Ctx() ctx: Context,
    @InlineQueryText() text: string | undefined,
  ): Promise<void> {
    const query = text ?? '';
    const results = new InlineQueryResultBuilder()
      .article({
        title: 'Echo',
        description: query || '(empty query)',
        text: query || 'You typed nothing.',
      })
      .build();
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  }

  /**
   * Logs which inline result the user picked. Only delivered once inline
   * feedback is enabled for the bot via @BotFather.
   *
   * @param ctx - The raw Telegraf context (`ctx.chosenInlineResult`).
   * @returns Nothing.
   * @throws Never.
   */
  @ChosenInlineResult()
  public onChosen(@Ctx() ctx: Context): void {
    console.log(`user chose result ${ctx.chosenInlineResult?.result_id}`);
  }
}

/**
 * Root module: wires the Bot API side and registers the inline-mode handler.
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
  providers: [InlineSearchUpdate],
})
export class InlineModeExampleModule {}
