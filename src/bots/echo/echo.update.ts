/**
 * @file src/bots/echo/echo.update.ts
 *
 * PURPOSE
 * -------
 * Update handlers for the echo bot, including greeting, generic text reply,
 * and reverse command support.
 *
 * USAGE
 * -----
 * Registered as a provider in EchoModule.
 */

import { Injectable } from '@nestjs/common';
import { Ctx, Help, Hears, On, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ECHO_GREETINGS, ECHO_HELP_TEXT } from './echo.constants';
import { EchoService } from './echo.service';

/**
 * Handles all update events that belong to the echo bot module.
 *
 * @param echoService - Domain service for text operations.
 */
@Update()
@Injectable()
export class EchoUpdate {
  constructor(private readonly echoService: EchoService) {}

  /**
   * Sends help text when the user starts the bot.
   *
   * @param ctx - Telegraf context for the incoming update.
   * @returns Promise that resolves after the reply is sent.
   * @throws {Error} When Telegram API request fails.
   */
  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(ECHO_HELP_TEXT);
  }

  /**
   * Sends help text when the user requests /help.
   *
   * @param ctx - Telegraf context for the incoming update.
   * @returns Promise that resolves after the reply is sent.
   * @throws {Error} When Telegram API request fails.
   */
  @Help()
  async onHelp(@Ctx() ctx: Context): Promise<void> {
    await ctx.reply(ECHO_HELP_TEXT);
  }

  /**
   * Replies with a friendly message for common greeting keywords.
   *
   * @param ctx - Telegraf context for the incoming update.
   * @returns Promise that resolves after the reply is sent.
   * @throws {Error} When Telegram API request fails.
   */
  @Hears([...ECHO_GREETINGS])
  async onGreeting(@Ctx() ctx: Context): Promise<void> {
    const name = ctx.from?.first_name ?? 'friend';
    await ctx.reply(`Hello ${name}. Send me text and I will echo it.`);
  }

  /**
   * Handles all text updates and supports "reverse <text>" instruction.
   *
   * @param ctx - Telegraf context for the incoming update.
   * @returns Promise that resolves after the reply is sent.
   * @throws {Error} When Telegram API request fails.
   */
  @On('text')
  async onText(@Ctx() ctx: Context): Promise<void> {
    const text = this.readMessageText(ctx);
    if (!text) return;

    // ── Reverse command path ───────────────────────────────────────────────
    if (text.toLowerCase().startsWith('reverse ')) {
      const original = text.slice('reverse '.length).trim();
      const reversed = this.echoService.reverse(original);
      await ctx.reply(reversed || 'Nothing to reverse.');
      return;
    }

    // ── Default echo path ──────────────────────────────────────────────────
    await ctx.reply(`Echo: ${text}`);
  }

  /**
   * Extracts plain text from a message update when available.
   *
   * @param ctx - Telegraf context carrying the update payload.
   * @returns Message text when the update contains a text message.
   * @throws {Error} Never intentionally throws.
   */
  private readMessageText(ctx: Context): string | undefined {
    const message = ctx.message;
    if (!message || typeof message !== 'object') return undefined;
    if (!('text' in message)) return undefined;

    const raw = message.text;
    return typeof raw === 'string' ? raw : undefined;
  }
}
