/**
 * @file src/lib/bot/telegram-bot.service.ts
 *
 * PURPOSE
 * -------
 * Injectable, strongly-typed facade over a `Telegraf` instance. It exposes the
 * most common Bot API methods with consistent error handling (every failure is
 * wrapped in a {@link TelegramBotApiError}), convenience handler-registration
 * helpers, and automatic launch/stop wired into the Nest lifecycle.
 *
 * The full Bot API remains reachable through {@link TelegramBotService.telegram}
 * (the raw Telegraf `Telegram` client) and {@link TelegramBotService.instance}
 * (the raw `Telegraf`), so nothing is hidden behind this facade.
 *
 * USAGE
 * -----
 * ```ts
 * constructor(private readonly bot: TelegramBotService) {}
 *
 * async notify(chatId: number) {
 *   await this.bot.sendMessage(chatId, 'Hello from NestJS!');
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramBotService: The injectable facade described above.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Telegraf, type Telegram } from 'telegraf';

import { TelegramBotApiError } from '../common';
import {
  decodeCallbackData as decodeCallbackDataFn,
  encodeCallbackData as encodeCallbackDataFn,
} from './callback-data.codec';
import { splitMessageText } from './message-splitter';
import { withRetry as withRetryFn, type WithRetryOptions } from './retry';
import { TELEGRAM_BOT } from './telegram-bot.constants';
import { TELEGRAM_BOT_OPTIONS } from './telegram-bot.module-definition';
import type { TelegramBotModuleOptions } from './telegram-bot.options';

/**
 * Strongly-typed Bot API facade. Method signatures are derived from Telegraf's
 * own `Telegram` type via `Parameters`/`ReturnType`, so they always stay in
 * lock-step with the installed Telegraf version and never drift.
 */
@Injectable()
export class TelegramBotService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy
{
  /** Module-scoped logger; child name keeps log lines attributable. */
  private readonly _logger = new Logger(TelegramBotService.name);

  /** Tracks whether {@link launch} has been invoked, so stop is idempotent. */
  private _launched = false;

  /**
   * @param bot - The raw `Telegraf` instance provided under `TELEGRAM_BOT`.
   * @param options - Validated module options controlling launch behaviour.
   */
  public constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Telegraf,
    @Inject(TELEGRAM_BOT_OPTIONS)
    private readonly options: TelegramBotModuleOptions,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Launches the bot after the Nest application has fully bootstrapped, unless
   * `launch` was explicitly set to `false` in the module options.
   *
   * Long-polling never resolves until the bot stops, so the launch promise is
   * intentionally not awaited; startup errors are caught and logged.
   *
   * @returns A promise that resolves once the launch has been kicked off.
   * @throws Never (launch failures are logged, not thrown, to avoid crashing
   *   bootstrap of unrelated modules).
   */
  public async onApplicationBootstrap(): Promise<void> {
    if (this.options.launch === false) {
      this._logger.log('Automatic launch disabled (options.launch === false).');
      return;
    }
    await this.launch();
  }

  /**
   * Stops the bot when the Nest application shuts down.
   *
   * @param signal - The OS signal that triggered shutdown, if any.
   * @returns A promise that resolves once the bot has been asked to stop.
   * @throws Never.
   */
  public async onApplicationShutdown(signal?: string): Promise<void> {
    this.stop(signal);
    return Promise.resolve();
  }

  /**
   * Stops the bot when its module is destroyed. This fires on `app.close()`
   * even when shutdown hooks are not enabled, so the bot is always torn down
   * cleanly; {@link stop} is idempotent so the overlap with
   * {@link onApplicationShutdown} is harmless.
   *
   * @returns A promise that resolves once the bot has been asked to stop.
   * @throws Never.
   */
  public async onModuleDestroy(): Promise<void> {
    this.stop('module destroy');
    return Promise.resolve();
  }

  /**
   * Starts the bot using the configured launch options (long-polling by
   * default, or webhook mode when `launchOptions.webhook` is present).
   *
   * @returns A promise that resolves once launch has been initiated.
   * @throws Never (errors are logged so a transient network failure during
   *   polling startup does not take down the host application).
   */
  public async launch(): Promise<void> {
    if (this._launched) return;
    this._launched = true;

    const mode = this.options.launchOptions?.webhook
      ? 'webhook'
      : 'long-polling';
    this._logger.log(`Launching Telegram bot in ${mode} mode.`);

    // ── Long-polling resolves only after the bot stops, so do not await it.
    //    A rejected launch is reported via the attached catch handler. The
    //    overload requires the config argument be omitted (not `undefined`). ──
    const launchOptions = this.options.launchOptions;
    const launching = launchOptions
      ? this.bot.launch(launchOptions)
      : this.bot.launch();
    void launching.catch((error: unknown) => {
      this._launched = false;
      const message = error instanceof Error ? error.message : String(error);
      this._logger.error(`Bot launch failed: ${message}`);
    });

    return Promise.resolve();
  }

  /**
   * Stops the bot if it is running.
   *
   * @param reason - Optional human-readable reason recorded in logs.
   * @returns Nothing.
   * @throws Never.
   */
  public stop(reason?: string): void {
    if (!this._launched) return;
    this._launched = false;
    this._logger.log(`Stopping Telegram bot${reason ? ` (${reason})` : ''}.`);
    try {
      this.bot.stop(reason);
    } catch (error) {
      // ── Telegraf throws "Bot is not running!" when stop races launch's
      //    async startup window. That is harmless and must not break the
      //    Nest shutdown sequence, so it is logged rather than rethrown. ─────
      const message = error instanceof Error ? error.message : String(error);
      this._logger.warn(`Ignoring bot stop error: ${message}`);
    }
  }

  // ── Raw accessors ──────────────────────────────────────────────────────────

  /** The underlying `Telegraf` instance, for scenes, middleware, etc. */
  public get instance(): Telegraf {
    return this.bot;
  }

  /** The raw Telegraf `Telegram` client, exposing the entire Bot API. */
  public get telegram(): Telegram {
    return this.bot.telegram;
  }

  // ── Handler registration (thin, typed delegates) ───────────────────────────

  /**
   * Registers a handler for the bot `/start` command.
   *
   * @param args - Middleware forwarded to `Telegraf.start`.
   * @returns The `Telegraf` instance for chaining.
   */
  public start(...args: Parameters<Telegraf['start']>): Telegraf {
    return this.bot.start(...args);
  }

  /**
   * Registers a handler for the bot `/help` command.
   *
   * @param args - Middleware forwarded to `Telegraf.help`.
   * @returns The `Telegraf` instance for chaining.
   */
  public help(...args: Parameters<Telegraf['help']>): Telegraf {
    return this.bot.help(...args);
  }

  /**
   * Registers a handler for one or more slash commands.
   *
   * @param args - Command name(s) and middleware forwarded to `Telegraf.command`.
   * @returns The `Telegraf` instance for chaining.
   */
  public command(...args: Parameters<Telegraf['command']>): Telegraf {
    return this.bot.command(...args);
  }

  /**
   * Registers a handler matched against incoming text.
   *
   * @param args - Trigger(s) and middleware forwarded to `Telegraf.hears`.
   * @returns The `Telegraf` instance for chaining.
   */
  public hears(...args: Parameters<Telegraf['hears']>): Telegraf {
    return this.bot.hears(...args);
  }

  /**
   * Registers a handler for inline-keyboard callback queries (button presses).
   *
   * @param args - Trigger(s) and middleware forwarded to `Telegraf.action`.
   * @returns The `Telegraf` instance for chaining.
   */
  public action(...args: Parameters<Telegraf['action']>): Telegraf {
    return this.bot.action(...args);
  }

  /**
   * Registers a handler for a specific update/message type (e.g. `'text'`).
   *
   * @param args - Update filter(s) and middleware forwarded to `Telegraf.on`.
   * @returns The `Telegraf` instance for chaining.
   */
  public on(...args: Parameters<Telegraf['on']>): Telegraf {
    return this.bot.on(...args);
  }

  /**
   * Registers global middleware that runs for every update. Exposed as a bound
   * getter (rather than a wrapper method) because `Telegraf.use` is a fully
   * generic variadic whose `Parameters<>` collapses to `never`; binding the
   * original preserves its exact overloaded signature.
   *
   * @returns The bound `Telegraf.use` function.
   */
  public get use(): Telegraf['use'] {
    return this.bot.use.bind(this.bot);
  }

  /**
   * Registers the global error handler invoked when a middleware throws.
   *
   * @param handler - Error handler forwarded to `Telegraf.catch`.
   * @returns Nothing.
   */
  public catch(handler: Parameters<Telegraf['catch']>[0]): void {
    this.bot.catch(handler);
  }

  // ── Messaging ───────────────────────────────────────────────────────────────

  /**
   * Sends a text message.
   *
   * @param args - Chat id, text, and optional `extra` forwarded to the Bot API.
   * @returns The sent message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendMessage(
    ...args: Parameters<Telegram['sendMessage']>
  ): Promise<Awaited<ReturnType<Telegram['sendMessage']>>> {
    return this.exec('sendMessage', () => this.telegram.sendMessage(...args));
  }

  /**
   * Sends a photo.
   *
   * @param args - Chat id, photo source, and optional `extra`.
   * @returns The sent message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendPhoto(
    ...args: Parameters<Telegram['sendPhoto']>
  ): Promise<Awaited<ReturnType<Telegram['sendPhoto']>>> {
    return this.exec('sendPhoto', () => this.telegram.sendPhoto(...args));
  }

  /**
   * Sends a general file/document.
   *
   * @param args - Chat id, document source, and optional `extra`.
   * @returns The sent message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendDocument(
    ...args: Parameters<Telegram['sendDocument']>
  ): Promise<Awaited<ReturnType<Telegram['sendDocument']>>> {
    return this.exec('sendDocument', () => this.telegram.sendDocument(...args));
  }

  /**
   * Sends a video.
   *
   * @param args - Chat id, video source, and optional `extra`.
   * @returns The sent message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendVideo(
    ...args: Parameters<Telegram['sendVideo']>
  ): Promise<Awaited<ReturnType<Telegram['sendVideo']>>> {
    return this.exec('sendVideo', () => this.telegram.sendVideo(...args));
  }

  /**
   * Sends an audio file.
   *
   * @param args - Chat id, audio source, and optional `extra`.
   * @returns The sent message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendAudio(
    ...args: Parameters<Telegram['sendAudio']>
  ): Promise<Awaited<ReturnType<Telegram['sendAudio']>>> {
    return this.exec('sendAudio', () => this.telegram.sendAudio(...args));
  }

  /**
   * Sends an album (media group) of photos and/or videos.
   *
   * @param args - Chat id, media array, and optional `extra`.
   * @returns The sent messages.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendMediaGroup(
    ...args: Parameters<Telegram['sendMediaGroup']>
  ): Promise<Awaited<ReturnType<Telegram['sendMediaGroup']>>> {
    return this.exec('sendMediaGroup', () =>
      this.telegram.sendMediaGroup(...args),
    );
  }

  /**
   * Sends a point on the map.
   *
   * @param args - Chat id, latitude, longitude, and optional `extra`.
   * @returns The sent message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendLocation(
    ...args: Parameters<Telegram['sendLocation']>
  ): Promise<Awaited<ReturnType<Telegram['sendLocation']>>> {
    return this.exec('sendLocation', () => this.telegram.sendLocation(...args));
  }

  /**
   * Sends a "typing"/"upload" chat action indicator.
   *
   * @param args - Chat id and the action forwarded to the Bot API.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendChatAction(
    ...args: Parameters<Telegram['sendChatAction']>
  ): Promise<Awaited<ReturnType<Telegram['sendChatAction']>>> {
    return this.exec('sendChatAction', () =>
      this.telegram.sendChatAction(...args),
    );
  }

  /**
   * Forwards a message from one chat to another.
   *
   * @param args - Target chat, source chat, message id, and optional `extra`.
   * @returns The forwarded message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public forwardMessage(
    ...args: Parameters<Telegram['forwardMessage']>
  ): Promise<Awaited<ReturnType<Telegram['forwardMessage']>>> {
    return this.exec('forwardMessage', () =>
      this.telegram.forwardMessage(...args),
    );
  }

  /**
   * Copies a message (without a "forwarded from" header).
   *
   * @param args - Target chat, source chat, message id, and optional `extra`.
   * @returns The new message id.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public copyMessage(
    ...args: Parameters<Telegram['copyMessage']>
  ): Promise<Awaited<ReturnType<Telegram['copyMessage']>>> {
    return this.exec('copyMessage', () => this.telegram.copyMessage(...args));
  }

  // ── Polls, stickers & reactions ─────────────────────────────────────────────

  /**
   * Sends a native poll (regular or quiz).
   *
   * @param args - Chat id, question, answer options, and optional `extra`.
   * @returns The sent poll message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendPoll(
    ...args: Parameters<Telegram['sendPoll']>
  ): Promise<Awaited<ReturnType<Telegram['sendPoll']>>> {
    return this.exec('sendPoll', () => this.telegram.sendPoll(...args));
  }

  /**
   * Stops an active poll and returns its final results.
   *
   * @param args - Chat id, message id, and optional `extra` (e.g. reply markup).
   * @returns The stopped `Poll` with final tallies.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public stopPoll(
    ...args: Parameters<Telegram['stopPoll']>
  ): Promise<Awaited<ReturnType<Telegram['stopPoll']>>> {
    return this.exec('stopPoll', () => this.telegram.stopPoll(...args));
  }

  /**
   * Sends a sticker (static, animated, or video).
   *
   * @param args - Chat id, sticker source, and optional `extra`.
   * @returns The sent sticker message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendSticker(
    ...args: Parameters<Telegram['sendSticker']>
  ): Promise<Awaited<ReturnType<Telegram['sendSticker']>>> {
    return this.exec('sendSticker', () => this.telegram.sendSticker(...args));
  }

  /**
   * Sets (or clears) the bot's emoji reactions on a message.
   *
   * @param args - Chat id, message id, reaction list, and optional `is_big`.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public setMessageReaction(
    ...args: Parameters<Telegram['setMessageReaction']>
  ): Promise<Awaited<ReturnType<Telegram['setMessageReaction']>>> {
    return this.exec('setMessageReaction', () =>
      this.telegram.setMessageReaction(...args),
    );
  }

  // ── Editing & deletion ──────────────────────────────────────────────────────

  /**
   * Edits the text of an existing message.
   *
   * @param args - Message coordinates, new text, and optional `extra`.
   * @returns The edited message, or `true` for inline messages.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public editMessageText(
    ...args: Parameters<Telegram['editMessageText']>
  ): Promise<Awaited<ReturnType<Telegram['editMessageText']>>> {
    return this.exec('editMessageText', () =>
      this.telegram.editMessageText(...args),
    );
  }

  /**
   * Edits the inline keyboard attached to a message.
   *
   * @param args - Message coordinates and the new reply markup.
   * @returns The edited message, or `true` for inline messages.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public editMessageReplyMarkup(
    ...args: Parameters<Telegram['editMessageReplyMarkup']>
  ): Promise<Awaited<ReturnType<Telegram['editMessageReplyMarkup']>>> {
    return this.exec('editMessageReplyMarkup', () =>
      this.telegram.editMessageReplyMarkup(...args),
    );
  }

  /**
   * Deletes a message.
   *
   * @param args - Chat id and message id.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public deleteMessage(
    ...args: Parameters<Telegram['deleteMessage']>
  ): Promise<Awaited<ReturnType<Telegram['deleteMessage']>>> {
    return this.exec('deleteMessage', () =>
      this.telegram.deleteMessage(...args),
    );
  }

  // ── Callback & inline answers ───────────────────────────────────────────────

  /**
   * Answers a callback query raised by an inline-keyboard button press.
   *
   * @param args - Callback query id and optional answer options.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public answerCbQuery(
    ...args: Parameters<Telegram['answerCbQuery']>
  ): Promise<Awaited<ReturnType<Telegram['answerCbQuery']>>> {
    return this.exec('answerCbQuery', () =>
      this.telegram.answerCbQuery(...args),
    );
  }

  // ── Chat & member management ────────────────────────────────────────────────

  /**
   * Returns the bot's own account information.
   *
   * @returns The bot `User` object.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getMe(): Promise<Awaited<ReturnType<Telegram['getMe']>>> {
    return this.exec('getMe', () => this.telegram.getMe());
  }

  /**
   * Fetches up-to-date information about a chat.
   *
   * @param args - Chat id or `@username`.
   * @returns The chat object.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getChat(
    ...args: Parameters<Telegram['getChat']>
  ): Promise<Awaited<ReturnType<Telegram['getChat']>>> {
    return this.exec('getChat', () => this.telegram.getChat(...args));
  }

  /**
   * Returns the number of members in a chat. (Telegraf 4.x exposes this under
   * the legacy Bot API name `getChatMembersCount`.)
   *
   * @param args - Chat id or `@username`.
   * @returns The member count.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getChatMembersCount(
    ...args: Parameters<Telegram['getChatMembersCount']>
  ): Promise<Awaited<ReturnType<Telegram['getChatMembersCount']>>> {
    return this.exec('getChatMembersCount', () =>
      this.telegram.getChatMembersCount(...args),
    );
  }

  /**
   * Bans a user from a group, supergroup, or channel.
   *
   * @param args - Chat id, user id, and optional ban parameters.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public banChatMember(
    ...args: Parameters<Telegram['banChatMember']>
  ): Promise<Awaited<ReturnType<Telegram['banChatMember']>>> {
    return this.exec('banChatMember', () =>
      this.telegram.banChatMember(...args),
    );
  }

  /**
   * Pins a message in a chat.
   *
   * @param args - Chat id, message id, and optional `extra`.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public pinChatMessage(
    ...args: Parameters<Telegram['pinChatMessage']>
  ): Promise<Awaited<ReturnType<Telegram['pinChatMessage']>>> {
    return this.exec('pinChatMessage', () =>
      this.telegram.pinChatMessage(...args),
    );
  }

  // ── Forum topics ────────────────────────────────────────────────────────────

  /**
   * Creates a new topic in a forum supergroup.
   *
   * @param args - Chat id, topic name, and optional `extra` (icon, color).
   * @returns The created `ForumTopic`.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public createForumTopic(
    ...args: Parameters<Telegram['createForumTopic']>
  ): Promise<Awaited<ReturnType<Telegram['createForumTopic']>>> {
    return this.exec('createForumTopic', () =>
      this.telegram.createForumTopic(...args),
    );
  }

  /**
   * Edits the name and/or icon of an existing forum topic.
   *
   * @param args - Chat id, topic thread id, and the `extra` to apply.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public editForumTopic(
    ...args: Parameters<Telegram['editForumTopic']>
  ): Promise<Awaited<ReturnType<Telegram['editForumTopic']>>> {
    return this.exec('editForumTopic', () =>
      this.telegram.editForumTopic(...args),
    );
  }

  /**
   * Closes an open forum topic (it can be reopened later).
   *
   * @param args - Chat id and the topic thread id.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public closeForumTopic(
    ...args: Parameters<Telegram['closeForumTopic']>
  ): Promise<Awaited<ReturnType<Telegram['closeForumTopic']>>> {
    return this.exec('closeForumTopic', () =>
      this.telegram.closeForumTopic(...args),
    );
  }

  /**
   * Reopens a previously closed forum topic.
   *
   * @param args - Chat id and the topic thread id.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public reopenForumTopic(
    ...args: Parameters<Telegram['reopenForumTopic']>
  ): Promise<Awaited<ReturnType<Telegram['reopenForumTopic']>>> {
    return this.exec('reopenForumTopic', () =>
      this.telegram.reopenForumTopic(...args),
    );
  }

  /**
   * Deletes a forum topic along with all of its messages.
   *
   * @param args - Chat id and the topic thread id.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public deleteForumTopic(
    ...args: Parameters<Telegram['deleteForumTopic']>
  ): Promise<Awaited<ReturnType<Telegram['deleteForumTopic']>>> {
    return this.exec('deleteForumTopic', () =>
      this.telegram.deleteForumTopic(...args),
    );
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  /**
   * Sends an invoice to a chat.
   *
   * @param args - Chat id, invoice parameters, and optional `extra`.
   * @returns The sent invoice message.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public sendInvoice(
    ...args: Parameters<Telegram['sendInvoice']>
  ): Promise<Awaited<ReturnType<Telegram['sendInvoice']>>> {
    return this.exec('sendInvoice', () => this.telegram.sendInvoice(...args));
  }

  /**
   * Creates a shareable invoice link (not tied to a specific chat).
   *
   * @param args - The invoice link parameters.
   * @returns The created invoice URL string.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public createInvoiceLink(
    ...args: Parameters<Telegram['createInvoiceLink']>
  ): Promise<Awaited<ReturnType<Telegram['createInvoiceLink']>>> {
    return this.exec('createInvoiceLink', () =>
      this.telegram.createInvoiceLink(...args),
    );
  }

  /**
   * Responds to a pre-checkout query (the final confirmation before payment).
   * Must be answered within 10 seconds or the payment is cancelled.
   *
   * @param args - Pre-checkout query id, `ok` flag, and optional error message.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public answerPreCheckoutQuery(
    ...args: Parameters<Telegram['answerPreCheckoutQuery']>
  ): Promise<Awaited<ReturnType<Telegram['answerPreCheckoutQuery']>>> {
    return this.exec('answerPreCheckoutQuery', () =>
      this.telegram.answerPreCheckoutQuery(...args),
    );
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  /**
   * Sets the list of the bot's commands shown in the Telegram UI.
   *
   * @param args - Command descriptors and optional scope/language.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public setMyCommands(
    ...args: Parameters<Telegram['setMyCommands']>
  ): Promise<Awaited<ReturnType<Telegram['setMyCommands']>>> {
    return this.exec('setMyCommands', () =>
      this.telegram.setMyCommands(...args),
    );
  }

  /**
   * Returns the current list of the bot's commands.
   *
   * @param args - Optional scope/language filter.
   * @returns The command descriptors.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getMyCommands(
    ...args: Parameters<Telegram['getMyCommands']>
  ): Promise<Awaited<ReturnType<Telegram['getMyCommands']>>> {
    return this.exec('getMyCommands', () =>
      this.telegram.getMyCommands(...args),
    );
  }

  // ── Bot profile & menu button ───────────────────────────────────────────────

  /**
   * Sets the bot's menu button for a chat (or the default for all chats).
   *
   * @param args - Optional `{ chatId?, menuButton? }`; omit to reset the default.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public setChatMenuButton(
    ...args: Parameters<Telegram['setChatMenuButton']>
  ): Promise<Awaited<ReturnType<Telegram['setChatMenuButton']>>> {
    return this.exec('setChatMenuButton', () =>
      this.telegram.setChatMenuButton(...args),
    );
  }

  /**
   * Reads the bot's current menu button for a chat (or the default).
   *
   * @param args - Optional `{ chatId? }`; omit for the default menu button.
   * @returns The current `MenuButton`.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getChatMenuButton(
    ...args: Parameters<Telegram['getChatMenuButton']>
  ): Promise<Awaited<ReturnType<Telegram['getChatMenuButton']>>> {
    return this.exec('getChatMenuButton', () =>
      this.telegram.getChatMenuButton(...args),
    );
  }

  /**
   * Sets the bot's description (shown in the chat when it is empty).
   *
   * @param args - The description text and optional language code.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public setMyDescription(
    ...args: Parameters<Telegram['setMyDescription']>
  ): Promise<Awaited<ReturnType<Telegram['setMyDescription']>>> {
    return this.exec('setMyDescription', () =>
      this.telegram.setMyDescription(...args),
    );
  }

  /**
   * Reads the bot's current description.
   *
   * @param args - Optional language code.
   * @returns The bot's `BotDescription`.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getMyDescription(
    ...args: Parameters<Telegram['getMyDescription']>
  ): Promise<Awaited<ReturnType<Telegram['getMyDescription']>>> {
    return this.exec('getMyDescription', () =>
      this.telegram.getMyDescription(...args),
    );
  }

  /**
   * Sets the bot's short description (shown on the profile page and in shares).
   *
   * @param args - The short description text and optional language code.
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public setMyShortDescription(
    ...args: Parameters<Telegram['setMyShortDescription']>
  ): Promise<Awaited<ReturnType<Telegram['setMyShortDescription']>>> {
    return this.exec('setMyShortDescription', () =>
      this.telegram.setMyShortDescription(...args),
    );
  }

  /**
   * Reads the bot's current short description.
   *
   * @param args - Optional language code.
   * @returns The bot's `BotShortDescription`.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getMyShortDescription(
    ...args: Parameters<Telegram['getMyShortDescription']>
  ): Promise<Awaited<ReturnType<Telegram['getMyShortDescription']>>> {
    return this.exec('getMyShortDescription', () =>
      this.telegram.getMyShortDescription(...args),
    );
  }

  // ── Files ───────────────────────────────────────────────────────────────────

  /**
   * Resolves a `file_id` to a downloadable `File` object.
   *
   * @param args - The `file_id` to resolve.
   * @returns The `File` object containing a `file_path`.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getFile(
    ...args: Parameters<Telegram['getFile']>
  ): Promise<Awaited<ReturnType<Telegram['getFile']>>> {
    return this.exec('getFile', () => this.telegram.getFile(...args));
  }

  /**
   * Resolves a `file_id` to a fully-qualified download URL.
   *
   * @param args - The `file_id` to resolve.
   * @returns A `URL` pointing at the file on Telegram's CDN.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getFileLink(
    ...args: Parameters<Telegram['getFileLink']>
  ): Promise<Awaited<ReturnType<Telegram['getFileLink']>>> {
    return this.exec('getFileLink', () => this.telegram.getFileLink(...args));
  }

  // ── Webhook administration ──────────────────────────────────────────────────

  /**
   * Registers the bot's webhook URL with Telegram.
   *
   * @param args - Webhook URL and optional `extra` (secret token, etc.).
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public setWebhook(
    ...args: Parameters<Telegram['setWebhook']>
  ): Promise<Awaited<ReturnType<Telegram['setWebhook']>>> {
    return this.exec('setWebhook', () => this.telegram.setWebhook(...args));
  }

  /**
   * Removes the bot's webhook integration (reverting to long-polling).
   *
   * @param args - Optional `extra` (e.g. `drop_pending_updates`).
   * @returns `true` on success.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public deleteWebhook(
    ...args: Parameters<Telegram['deleteWebhook']>
  ): Promise<Awaited<ReturnType<Telegram['deleteWebhook']>>> {
    return this.exec('deleteWebhook', () =>
      this.telegram.deleteWebhook(...args),
    );
  }

  /**
   * Returns the current webhook status.
   *
   * @returns The webhook info object.
   * @throws {TelegramBotApiError} If the Bot API request fails.
   */
  public getWebhookInfo(): Promise<
    Awaited<ReturnType<Telegram['getWebhookInfo']>>
  > {
    return this.exec('getWebhookInfo', () => this.telegram.getWebhookInfo());
  }

  /**
   * Returns an HTTP-framework middleware that feeds incoming webhook updates to
   * the bot. Mount it on your Nest/Express app to run in webhook mode while
   * keeping `launch` disabled.
   *
   * @param args - The webhook path forwarded to `Telegraf.webhookCallback`.
   * @returns A request handler middleware.
   * @throws Never.
   */
  public webhookCallback(
    ...args: Parameters<Telegraf['webhookCallback']>
  ): ReturnType<Telegraf['webhookCallback']> {
    return this.bot.webhookCallback(...args);
  }

  // ── Convenience helpers ─────────────────────────────────────────────────────

  /**
   * Downloads a file by its `file_id` and buffers it fully in memory.
   *
   * Resolves the `file_id` to its CDN URL via `getFileLink` and fetches the
   * bytes. Prefer {@link downloadFileStream} for large files to avoid loading
   * the whole payload into memory.
   *
   * @param fileId - The `file_id` (or a `File`) to download.
   * @returns The file contents as a `Buffer`.
   * @throws {TelegramBotApiError} If resolving the link or fetching the bytes
   *   fails (including a non-2xx HTTP response).
   *
   * @example
   * ```ts
   * const buf = await bot.downloadFile(ctx.message.document.file_id);
   * await fs.promises.writeFile('out.bin', buf);
   * ```
   */
  public downloadFile(
    fileId: Parameters<Telegram['getFileLink']>[0],
  ): Promise<Buffer> {
    return this.exec('downloadFile', async () => {
      const link = await this.telegram.getFileLink(fileId);
      const response = await fetch(link);
      if (!response.ok)
        throw new Error(
          `file download failed: HTTP ${response.status} ${response.statusText}`,
        );
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    });
  }

  /**
   * Downloads a file by its `file_id` as a streaming body, so large files are
   * not buffered entirely in memory.
   *
   * @param fileId - The `file_id` (or a `File`) to download.
   * @returns A web `ReadableStream` of the file's bytes.
   * @throws {TelegramBotApiError} If resolving the link or fetching the bytes
   *   fails (including a non-2xx HTTP response or an empty body).
   *
   * @example
   * ```ts
   * const stream = await bot.downloadFileStream(fileId);
   * await pipeline(Readable.fromWeb(stream), createWriteStream('out.bin'));
   * ```
   */
  public downloadFileStream(
    fileId: Parameters<Telegram['getFileLink']>[0],
  ): Promise<ReadableStream<Uint8Array>> {
    return this.exec('downloadFileStream', async () => {
      const link = await this.telegram.getFileLink(fileId);
      const response = await fetch(link);
      if (!response.ok)
        throw new Error(
          `file download failed: HTTP ${response.status} ${response.statusText}`,
        );
      if (response.body === null)
        throw new Error('file download failed: response body was empty.');
      return response.body;
    });
  }

  /**
   * Sends `text` as one or more messages, automatically splitting it on line
   * boundaries so no single message exceeds Telegram's 4096-character limit.
   *
   * Messages are sent sequentially to preserve their order. Empty/blank text
   * sends nothing and returns an empty array. The same `extra` is applied to
   * every chunk; note that a `reply_markup` will therefore appear on each part.
   *
   * @param chatId - Target chat id or `@username`.
   * @param text - The full text to send (any length).
   * @param extra - Optional send options forwarded to each `sendMessage` call.
   * @returns The sent messages, in order (empty if `text` was empty).
   * @throws {TelegramBotApiError} If any underlying `sendMessage` call fails.
   *
   * @example
   * ```ts
   * await bot.sendLongMessage(chatId, veryLongReport);
   * ```
   */
  public async sendLongMessage(
    chatId: Parameters<Telegram['sendMessage']>[0],
    text: string,
    extra?: Parameters<Telegram['sendMessage']>[2],
  ): Promise<Awaited<ReturnType<Telegram['sendMessage']>>[]> {
    const sent: Awaited<ReturnType<Telegram['sendMessage']>>[] = [];
    // ── Sequential, not parallel: Telegram preserves order this way and we stay
    //    within per-chat rate limits instead of bursting every chunk at once. ─
    for (const chunk of splitMessageText(text)) {
      sent.push(await this.sendMessage(chatId, chunk, extra));
    }
    return sent;
  }

  /**
   * Runs `fn`, retrying it when Telegram responds with `429 Too Many Requests`
   * by waiting for the `retry_after` interval it reports. Non-rate-limit errors
   * propagate immediately. Thin instance wrapper around the standalone
   * {@link withRetryFn} helper, for callers that already hold the service.
   *
   * @typeParam T - The resolved result type of `fn`.
   * @param fn - The async operation to run (typically a Bot API call).
   * @param options - Retry tuning; see {@link WithRetryOptions}.
   * @returns The resolved value of `fn`.
   * @throws The original error if it is not a rate-limit error, or the last
   *   rate-limit error after retries are exhausted.
   *
   * @example
   * ```ts
   * await bot.withRetry(() => bot.sendMessage(id, text), { retries: 5 });
   * ```
   */
  public withRetry<T>(
    fn: () => Promise<T>,
    options?: WithRetryOptions,
  ): Promise<T> {
    return withRetryFn(fn, options);
  }

  /**
   * Encodes a structured payload into a 64-byte-safe `callback_data` string.
   * Thin instance wrapper around the standalone {@link encodeCallbackDataFn}.
   *
   * @typeParam T - The (JSON-serializable) payload shape.
   * @param payload - The value to encode.
   * @returns The encoded string (≤ 64 bytes).
   * @throws {RangeError} If the encoding exceeds 64 bytes.
   * @throws {TypeError} If the payload is not JSON-serializable.
   */
  public encodeCallbackData<T>(payload: T): string {
    return encodeCallbackDataFn(payload);
  }

  /**
   * Decodes a `callback_data` string produced by {@link encodeCallbackData}.
   * Thin instance wrapper around the standalone {@link decodeCallbackDataFn}.
   *
   * @typeParam T - The expected decoded payload shape (defaults to `unknown`).
   * @param data - The encoded string (typically `ctx.match.input`).
   * @returns The decoded payload, typed as `T`.
   * @throws {TypeError} If `data` is not valid JSON.
   */
  public decodeCallbackData<T = unknown>(data: string): T {
    return decodeCallbackDataFn<T>(data);
  }

  // ── Internal error handling ─────────────────────────────────────────────────

  /**
   * Executes a Bot API call, normalizing any thrown value into a
   * {@link TelegramBotApiError}.
   *
   * @typeParam T - The resolved result type of the call.
   * @param method - Name of the Bot API method, for diagnostics.
   * @param fn - Thunk performing the actual Telegraf call.
   * @returns The result of `fn`.
   * @throws {TelegramBotApiError} Always, when `fn` rejects.
   */
  private async exec<T>(method: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.toBotApiError(method, error);
    }
  }

  /**
   * Normalizes an unknown thrown value into a {@link TelegramBotApiError},
   * extracting Telegram's numeric error code where present.
   *
   * @param method - The Bot API method that failed.
   * @param error - The unknown thrown value.
   * @returns A typed {@link TelegramBotApiError} wrapping the cause.
   * @throws Never.
   */
  private toBotApiError(method: string, error: unknown): TelegramBotApiError {
    if (error instanceof TelegramBotApiError) return error;

    const description = error instanceof Error ? error.message : String(error);
    let statusCode: number | undefined;
    let retryAfterSeconds: number | undefined;

    // ── Telegraf surfaces Telegram's status either as `.code` or nested under
    //    `.response.error_code`, and rate-limit back-off under
    //    `.response.parameters.retry_after`; probe all without assuming `any`. ─
    if (typeof error === 'object' && error !== null) {
      const candidate = error as {
        code?: unknown;
        response?: {
          error_code?: unknown;
          parameters?: { retry_after?: unknown };
        };
        parameters?: { retry_after?: unknown };
      };
      if (typeof candidate.code === 'number') statusCode = candidate.code;
      else if (typeof candidate.response?.error_code === 'number')
        statusCode = candidate.response.error_code;

      const rawRetryAfter =
        candidate.response?.parameters?.retry_after ??
        candidate.parameters?.retry_after;
      if (typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter))
        retryAfterSeconds = rawRetryAfter;
    }

    return new TelegramBotApiError(
      `Bot API "${method}" failed: ${description}`,
      {
        statusCode,
        method,
        retryAfterSeconds,
        cause: error,
      },
    );
  }
}
