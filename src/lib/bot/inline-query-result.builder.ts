/**
 * @file src/lib/bot/inline-query-result.builder.ts
 *
 * PURPOSE
 * -------
 * A fluent, fully-typed builder for the `results` array passed to the Bot API
 * `answerInlineQuery` method. It exposes one chainable method per common inline
 * query result type (article, photo, document, …, plus the cached `*_file_id`
 * variants) and auto-assigns a unique `id` to each result when the caller does
 * not supply one, so the emitted array is directly assignable to Telegraf's
 * strict `answerInlineQuery` / `ctx.answerInlineQuery` signature.
 *
 * Every result type and option shape is *derived from Telegraf's own types* via
 * `Parameters<Telegram['answerInlineQuery']>` (rather than importing `typegram`/
 * `@telegraf/types` directly), so the builder stays in lock-step with the
 * installed Telegraf version and never drifts.
 *
 * USAGE
 * -----
 * ```ts
 * const results = new InlineQueryResultBuilder()
 *   .article({ title: 'Echo', text: query })
 *   .photo({ photo_url: url, thumbnail_url: thumb, title: 'A photo' })
 *   .build();
 *
 * await ctx.answerInlineQuery(results, { cache_time: 0 });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - InlineQueryResult / InputMessageContent / InputTextMessageContent: the
 *   Telegraf-derived result + message-content types re-exported for consumers.
 * - InlineQueryResultBuilder: the fluent builder described above.
 */

import type { Telegram } from 'telegraf';

/**
 * One element of the Bot API `answerInlineQuery` `results` array, derived from
 * Telegraf's own method signature so it tracks the installed version.
 */
export type InlineQueryResult =
  Parameters<Telegram['answerInlineQuery']>[1][number];

/** The `article` result variant (its `input_message_content` is mandatory). */
type ArticleResult = Extract<InlineQueryResult, { type: 'article' }>;

/**
 * The content of a message sent as the result of an inline query (text,
 * location, venue, contact, or invoice), derived from the `article` result's
 * mandatory `input_message_content` field.
 */
export type InputMessageContent = NonNullable<
  ArticleResult['input_message_content']
>;

/** The plain-text variant of {@link InputMessageContent}. */
export type InputTextMessageContent = Extract<
  InputMessageContent,
  { message_text: string }
>;

/**
 * Options for a result builder method: the underlying Telegraf result shape with
 * its fixed `type` discriminant removed and its `id` made optional (the builder
 * fills in a unique id when omitted).
 *
 * @typeParam R - The concrete inline-query-result variant being built.
 */
type ResultOptions<R extends InlineQueryResult> = Omit<R, 'type' | 'id'> & {
  /** Unique result id (1-64 bytes); auto-generated when omitted. */
  readonly id?: string;
};

/** Convenience aliases selecting each concrete result variant from the union. */
type PhotoResult = Extract<InlineQueryResult, { type: 'photo'; photo_url: string }>;
type GifResult = Extract<InlineQueryResult, { type: 'gif'; gif_url: string }>;
type Mpeg4GifResult = Extract<
  InlineQueryResult,
  { type: 'mpeg4_gif'; mpeg4_url: string }
>;
type VideoResult = Extract<InlineQueryResult, { type: 'video'; video_url: string }>;
type AudioResult = Extract<InlineQueryResult, { type: 'audio'; audio_url: string }>;
type VoiceResult = Extract<InlineQueryResult, { type: 'voice'; voice_url: string }>;
type DocumentResult = Extract<
  InlineQueryResult,
  { type: 'document'; document_url: string }
>;
type LocationResult = Extract<InlineQueryResult, { type: 'location' }>;
type VenueResult = Extract<InlineQueryResult, { type: 'venue' }>;
type ContactResult = Extract<InlineQueryResult, { type: 'contact' }>;
type GameResult = Extract<InlineQueryResult, { type: 'game' }>;
type CachedPhotoResult = Extract<
  InlineQueryResult,
  { type: 'photo'; photo_file_id: string }
>;
type CachedGifResult = Extract<
  InlineQueryResult,
  { type: 'gif'; gif_file_id: string }
>;
type CachedMpeg4GifResult = Extract<
  InlineQueryResult,
  { type: 'mpeg4_gif'; mpeg4_file_id: string }
>;
type CachedStickerResult = Extract<InlineQueryResult, { type: 'sticker' }>;
type CachedDocumentResult = Extract<
  InlineQueryResult,
  { type: 'document'; document_file_id: string }
>;
type CachedVideoResult = Extract<
  InlineQueryResult,
  { type: 'video'; video_file_id: string }
>;
type CachedVoiceResult = Extract<
  InlineQueryResult,
  { type: 'voice'; voice_file_id: string }
>;
type CachedAudioResult = Extract<
  InlineQueryResult,
  { type: 'audio'; audio_file_id: string }
>;

/** Article options with an ergonomic `text` shorthand for the message body. */
type ArticleOptions = Omit<
  ResultOptions<ArticleResult>,
  'input_message_content'
> & {
  /** Content of the message to send; required unless `text` is given. */
  readonly input_message_content?: InputMessageContent;
  /**
   * Shorthand for a plain-text `input_message_content`. Ignored when
   * `input_message_content` is supplied explicitly.
   */
  readonly text?: string;
};

/**
 * Fluent builder accumulating an ordered list of inline query results. Each
 * `add*`-style method appends one result and returns `this` for chaining;
 * {@link InlineQueryResultBuilder.build} returns an immutable snapshot suitable
 * for `answerInlineQuery`.
 *
 * Results without an explicit `id` receive a unique auto-generated one
 * (`auto_0`, `auto_1`, …) so the Bot API's "ids must be unique" rule is met
 * without the caller bookkeeping.
 */
export class InlineQueryResultBuilder {
  /** Results accumulated so far, in insertion order. */
  private readonly _results: InlineQueryResult[] = [];

  /** Monotonic counter backing auto-generated result ids. */
  private _autoId = 0;

  /**
   * Resolves the id for a result: the caller's explicit id, or the next
   * auto-generated one. Explicit ids are validated against Telegram's 1-64 byte
   * limit so an oversized id fails fast here rather than as an opaque 400.
   *
   * @param explicit - The caller-supplied id, if any.
   * @returns A unique, length-valid result id.
   * @throws {RangeError} If an explicit id is empty or exceeds 64 bytes.
   */
  private idFor(explicit?: string): string {
    if (explicit === undefined) return `auto_${this._autoId++}`;
    const bytes = Buffer.byteLength(explicit, 'utf8');
    if (bytes < 1 || bytes > 64)
      throw new RangeError('inline query result id must be 1-64 bytes');
    return explicit;
  }

  /**
   * Appends a link to an article or web page. Provide the message body via
   * `input_message_content`, or the `text` shorthand for a plain-text message.
   *
   * @param options - Article fields (`title` required) plus the message body.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   * @throws {TypeError} If neither `input_message_content` nor `text` is given.
   */
  public article(options: ArticleOptions): this {
    const { id, text, input_message_content, ...rest } = options;
    // ── Accept either an explicit content object or the text shorthand. ────────
    const content: InputMessageContent | undefined =
      input_message_content ??
      (text !== undefined ? { message_text: text } : undefined);
    if (content === undefined)
      throw new TypeError(
        'article requires input_message_content or the text shorthand',
      );
    this._results.push({
      type: 'article',
      id: this.idFor(id),
      input_message_content: content,
      ...rest,
    });
    return this;
  }

  /**
   * Appends a link to a JPEG photo (`photo_url` + `thumbnail_url`).
   *
   * @param options - Photo fields; `photo_url` and `thumbnail_url` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public photo(options: ResultOptions<PhotoResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'photo', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a link to an animated GIF (`gif_url` + `thumbnail_url`).
   *
   * @param options - GIF fields; `gif_url` and `thumbnail_url` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public gif(options: ResultOptions<GifResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'gif', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a link to an MPEG-4 video animation (`mpeg4_url` + `thumbnail_url`).
   *
   * @param options - Fields; `mpeg4_url` and `thumbnail_url` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public mpeg4Gif(options: ResultOptions<Mpeg4GifResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'mpeg4_gif', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a link to a video (`video_url`, `mime_type`, `thumbnail_url`,
   * `title`). For an HTML page (e.g. a YouTube embed) you must also supply
   * `input_message_content`.
   *
   * @param options - Video fields; the four listed above are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public video(options: ResultOptions<VideoResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'video', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a link to an MP3 audio file (`audio_url` + `title`).
   *
   * @param options - Audio fields; `audio_url` and `title` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public audio(options: ResultOptions<AudioResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'audio', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a link to an OGG/OPUS voice recording (`voice_url` + `title`).
   *
   * @param options - Voice fields; `voice_url` and `title` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public voice(options: ResultOptions<VoiceResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'voice', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a link to a PDF or ZIP file (`document_url`, `mime_type`, `title`).
   *
   * @param options - Document fields; the three listed above are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public document(options: ResultOptions<DocumentResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'document', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a location on a map (`latitude`, `longitude`, `title`).
   *
   * @param options - Location fields; the three listed above are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public location(options: ResultOptions<LocationResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'location', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a venue (`latitude`, `longitude`, `title`, `address`).
   *
   * @param options - Venue fields; the four listed above are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public venue(options: ResultOptions<VenueResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'venue', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a contact (`phone_number`, `first_name`).
   *
   * @param options - Contact fields; the two listed above are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public contact(options: ResultOptions<ContactResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'contact', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a Game result (`game_short_name`).
   *
   * @param options - Game fields; `game_short_name` is required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public game(options: ResultOptions<GameResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'game', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached photo stored on Telegram's servers (`photo_file_id`).
   *
   * @param options - Fields; `photo_file_id` is required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedPhoto(options: ResultOptions<CachedPhotoResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'photo', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached GIF stored on Telegram's servers (`gif_file_id`).
   *
   * @param options - Fields; `gif_file_id` is required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedGif(options: ResultOptions<CachedGifResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'gif', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached MPEG-4 GIF stored on Telegram's servers (`mpeg4_file_id`).
   *
   * @param options - Fields; `mpeg4_file_id` is required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedMpeg4Gif(options: ResultOptions<CachedMpeg4GifResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'mpeg4_gif', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached sticker stored on Telegram's servers (`sticker_file_id`).
   *
   * @param options - Fields; `sticker_file_id` is required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedSticker(options: ResultOptions<CachedStickerResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'sticker', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached document stored on Telegram's servers (`document_file_id`).
   *
   * @param options - Fields; `document_file_id` and `title` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedDocument(options: ResultOptions<CachedDocumentResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'document', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached video stored on Telegram's servers (`video_file_id`).
   *
   * @param options - Fields; `video_file_id` and `title` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedVideo(options: ResultOptions<CachedVideoResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'video', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached voice message stored on Telegram's servers
   * (`voice_file_id`).
   *
   * @param options - Fields; `voice_file_id` and `title` are required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedVoice(options: ResultOptions<CachedVoiceResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'voice', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a cached audio file stored on Telegram's servers (`audio_file_id`).
   *
   * @param options - Fields; `audio_file_id` is required.
   * @returns This builder, for chaining.
   * @throws {RangeError} If an explicit `id` is out of range.
   */
  public cachedAudio(options: ResultOptions<CachedAudioResult>): this {
    const { id, ...rest } = options;
    this._results.push({ type: 'audio', id: this.idFor(id), ...rest });
    return this;
  }

  /**
   * Appends a fully-formed result verbatim — an escape hatch for any variant or
   * field combination the typed helpers above do not cover. The result's own
   * `id` is used as-is (no auto-generation, no validation).
   *
   * @param result - A complete {@link InlineQueryResult}.
   * @returns This builder, for chaining.
   * @throws Never.
   */
  public add(result: InlineQueryResult): this {
    this._results.push(result);
    return this;
  }

  /**
   * Builds the immutable results array for `answerInlineQuery`.
   *
   * @returns A shallow copy of the accumulated results, in insertion order.
   * @throws Never.
   */
  public build(): InlineQueryResult[] {
    return [...this._results];
  }

  /**
   * Builds a plain-text {@link InputTextMessageContent}, the most common message
   * body for an `article` (or any result that overrides its sent message).
   *
   * @param messageText - The message text (1-4096 characters).
   * @param extra - Optional extra content fields (`parse_mode`, `entities`,
   *   `link_preview_options`).
   * @returns An `InputTextMessageContent` object.
   * @throws Never.
   */
  public static text(
    messageText: string,
    extra?: Omit<InputTextMessageContent, 'message_text'>,
  ): InputTextMessageContent {
    return { message_text: messageText, ...extra };
  }
}
