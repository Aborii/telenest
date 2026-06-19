/**
 * @file src/lib/bot/keyboard.builder.ts
 *
 * PURPOSE
 * -------
 * Fluent, fully-typed builders for Telegram inline and reply keyboards. They
 * emit plain `reply_markup` objects that match the Bot API JSON schema and are
 * directly assignable to Telegraf's send-message `extra` argument, so they work
 * with both the {@link import('./telegram-bot.service').TelegramBotService}
 * facade and the raw `Telegraf` instance.
 *
 * USAGE
 * -----
 * ```ts
 * const markup = new InlineKeyboardBuilder()
 *   .url('Docs', 'https://core.telegram.org/bots/api')
 *   .callback('Ping', 'ping')
 *   .row()
 *   .callback('Cancel', 'cancel')
 *   .build();
 *
 * await bot.sendMessage(chatId, 'Choose:', { reply_markup: markup });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - InlineKeyboardButton / ReplyKeyboardButton: Button shapes.
 * - InlineKeyboardBuilder / ReplyKeyboardBuilder: Fluent builders.
 * - removeKeyboard / forceReply: One-shot markup helpers.
 */

/**
 * A single inline keyboard button. Modeled as a discriminated union — each
 * variant carries exactly one action field — so the emitted markup is
 * structurally assignable to Telegraf's strict `reply_markup` union (the Bot
 * API rejects buttons with zero or multiple action fields).
 */
export type InlineKeyboardButton =
  | { text: string; url: string }
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } }
  | { text: string; switch_inline_query: string }
  | { text: string; switch_inline_query_current_chat: string }
  | { text: string; pay: true };

/**
 * A single reply (custom) keyboard button. A bare label is the common case;
 * the request variants ask the client to share a contact or location.
 */
export type ReplyKeyboardButton =
  | { text: string }
  | { text: string; request_contact: true }
  | { text: string; request_location: true };

/** Inline keyboard markup object accepted as `reply_markup`. */
export interface InlineKeyboardMarkup {
  /** Rows of inline buttons. */
  inline_keyboard: InlineKeyboardButton[][];
}

/** Markup that removes any custom reply keyboard. */
export interface RemoveKeyboardMarkup {
  /** Always `true`; instructs the client to hide the custom keyboard. */
  remove_keyboard: true;
  /** Remove the keyboard only for specific targeted users. */
  selective?: boolean;
}

/** Markup that forces the user to reply to the message. */
export interface ForceReply {
  /** Always `true`; shows the reply UI immediately. */
  force_reply: true;
  /** Placeholder shown in the empty input field. */
  input_field_placeholder?: string;
  /** Force a reply only from specific targeted users. */
  selective?: boolean;
}

/** Reply (custom) keyboard markup object accepted as `reply_markup`. */
export interface ReplyKeyboardMarkup {
  /** Rows of reply buttons. */
  keyboard: ReplyKeyboardButton[][];
  /** Resize the keyboard to fit the buttons rather than the default height. */
  resize_keyboard?: boolean;
  /** Hide the keyboard after a single use. */
  one_time_keyboard?: boolean;
  /** Placeholder shown in the empty input field. */
  input_field_placeholder?: string;
  /** Show the keyboard only to specific users mentioned in the message. */
  selective?: boolean;
}

/**
 * Fluent builder for inline keyboards. Buttons accumulate into the current row;
 * call {@link InlineKeyboardBuilder.row} to start a new row.
 *
 * The builder is mutable and chainable; call {@link InlineKeyboardBuilder.build}
 * to obtain an immutable snapshot. Empty rows are dropped on build.
 */
export class InlineKeyboardBuilder {
  /** Completed rows. */
  private readonly _rows: InlineKeyboardButton[][] = [];

  /** Buttons accumulated for the row currently being built. */
  private _current: InlineKeyboardButton[] = [];

  /**
   * Appends an arbitrary inline button to the current row.
   *
   * @param button - Fully-formed inline button.
   * @returns This builder, for chaining.
   */
  public button(button: InlineKeyboardButton): this {
    this._current.push(button);
    return this;
  }

  /**
   * Appends a URL button to the current row.
   *
   * @param text - Button label.
   * @param url - Destination URL.
   * @returns This builder, for chaining.
   */
  public url(text: string, url: string): this {
    return this.button({ text, url });
  }

  /**
   * Appends a callback button to the current row.
   *
   * @param text - Button label.
   * @param callbackData - Payload (1-64 bytes) echoed back as a callback query.
   * @returns This builder, for chaining.
   * @throws {RangeError} If `callbackData` exceeds Telegram's 64-byte limit.
   */
  public callback(text: string, callbackData: string): this {
    // ── Telegram rejects callback_data longer than 64 bytes; fail fast so the
    //    error is attributable here rather than as an opaque 400 at send time.
    if (Buffer.byteLength(callbackData, 'utf8') > 64)
      throw new RangeError('callback_data must be 1-64 bytes');
    return this.button({ text, callback_data: callbackData });
  }

  /**
   * Appends a Web App button to the current row.
   *
   * @param text - Button label.
   * @param url - HTTPS URL of the Web App to open.
   * @returns This builder, for chaining.
   */
  public webApp(text: string, url: string): this {
    return this.button({ text, web_app: { url } });
  }

  /**
   * Finalizes the current row and starts a new one. No-op when the current row
   * is empty, so it is safe to call between logical groups.
   *
   * @returns This builder, for chaining.
   */
  public row(): this {
    if (this._current.length > 0) {
      this._rows.push(this._current);
      this._current = [];
    }
    return this;
  }

  /**
   * Builds the immutable inline keyboard markup.
   *
   * @returns A `reply_markup`-compatible inline keyboard object.
   */
  public build(): InlineKeyboardMarkup {
    this.row();
    return { inline_keyboard: this._rows.map((row) => [...row]) };
  }
}

/**
 * Fluent builder for reply (custom) keyboards. Mirrors
 * {@link InlineKeyboardBuilder} but emits {@link ReplyKeyboardMarkup}.
 */
export class ReplyKeyboardBuilder {
  /** Completed rows. */
  private readonly _rows: ReplyKeyboardButton[][] = [];

  /** Buttons accumulated for the row currently being built. */
  private _current: ReplyKeyboardButton[] = [];

  /** Mutable markup-level flags applied on {@link ReplyKeyboardBuilder.build}. */
  private readonly _options: Omit<ReplyKeyboardMarkup, 'keyboard'> = {};

  /**
   * Appends a plain-text reply button to the current row.
   *
   * @param text - Button label, sent as a message when pressed.
   * @returns This builder, for chaining.
   */
  public text(text: string): this {
    this._current.push({ text });
    return this;
  }

  /**
   * Appends a button that asks the user to share their contact.
   *
   * @param text - Button label.
   * @returns This builder, for chaining.
   */
  public requestContact(text: string): this {
    this._current.push({ text, request_contact: true });
    return this;
  }

  /**
   * Appends a button that asks the user to share their location.
   *
   * @param text - Button label.
   * @returns This builder, for chaining.
   */
  public requestLocation(text: string): this {
    this._current.push({ text, request_location: true });
    return this;
  }

  /**
   * Finalizes the current row and starts a new one. No-op for an empty row.
   *
   * @returns This builder, for chaining.
   */
  public row(): this {
    if (this._current.length > 0) {
      this._rows.push(this._current);
      this._current = [];
    }
    return this;
  }

  /**
   * Requests that the client resize the keyboard to fit the buttons.
   *
   * @param value - Whether to resize (default `true`).
   * @returns This builder, for chaining.
   */
  public resize(value = true): this {
    this._options.resize_keyboard = value;
    return this;
  }

  /**
   * Requests that the client hide the keyboard after a single use.
   *
   * @param value - Whether to hide after one use (default `true`).
   * @returns This builder, for chaining.
   */
  public oneTime(value = true): this {
    this._options.one_time_keyboard = value;
    return this;
  }

  /**
   * Sets the placeholder text shown in the empty input field.
   *
   * @param placeholder - Placeholder string (1-64 characters).
   * @returns This builder, for chaining.
   */
  public placeholder(placeholder: string): this {
    this._options.input_field_placeholder = placeholder;
    return this;
  }

  /**
   * Shows the keyboard only to specific users (those @mentioned in the message
   * text, or the user being replied to).
   *
   * @param value - Whether targeting is selective (default `true`).
   * @returns This builder, for chaining.
   */
  public selective(value = true): this {
    this._options.selective = value;
    return this;
  }

  /**
   * Builds the immutable reply keyboard markup.
   *
   * @returns A `reply_markup`-compatible reply keyboard object.
   */
  public build(): ReplyKeyboardMarkup {
    this.row();
    return {
      keyboard: this._rows.map((row) => [...row]),
      ...this._options,
    };
  }
}

/**
 * Builds a markup object that removes any custom reply keyboard.
 *
 * @param selective - When `true`, removes the keyboard only for targeted users.
 * @returns A `reply_markup`-compatible remove-keyboard object.
 */
export function removeKeyboard(selective = false): RemoveKeyboardMarkup {
  return selective
    ? { remove_keyboard: true, selective: true }
    : { remove_keyboard: true };
}

/**
 * Builds a markup object that forces the user to reply to the message.
 *
 * @param options - Optional placeholder and selective targeting.
 * @returns A `reply_markup`-compatible force-reply object.
 */
export function forceReply(options?: {
  inputFieldPlaceholder?: string;
  selective?: boolean;
}): ForceReply {
  return {
    force_reply: true,
    ...(options?.inputFieldPlaceholder
      ? { input_field_placeholder: options.inputFieldPlaceholder }
      : {}),
    ...(options?.selective ? { selective: true } : {}),
  };
}
