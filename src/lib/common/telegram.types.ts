/**
 * @file src/lib/common/telegram.types.ts
 *
 * PURPOSE
 * -------
 * Small, dependency-free scalar types shared across the Bot API and MTProto
 * sides of the library. Keeping them here avoids importing Telegraf or GramJS
 * types into consumer code just to name a parse mode or a chat id.
 *
 * USAGE
 * -----
 * ```ts
 * import { ParseMode, ChatId } from 'telenest';
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - PARSE_MODES / ParseMode: Telegram text formatting modes.
 * - ChatId: Numeric id or `@username` accepted by the Bot API.
 * - Awaitable: `T | Promise<T>` helper for pluggable async hooks.
 */

/**
 * Telegram text formatting modes. Declared as an `as const` record (never an
 * `enum`) so the {@link ParseMode} union can be derived from it.
 */
export const PARSE_MODES = {
  /** Legacy Markdown formatting. Prefer `MarkdownV2` for new code. */
  MARKDOWN: 'Markdown',
  /** Strict MarkdownV2 formatting with full escaping rules. */
  MARKDOWN_V2: 'MarkdownV2',
  /** HTML formatting (`<b>`, `<i>`, `<a>`, …). */
  HTML: 'HTML',
} as const;

/** Union of supported Telegram parse modes. */
export type ParseMode = (typeof PARSE_MODES)[keyof typeof PARSE_MODES];

/** Readonly array form of {@link PARSE_MODES} for runtime validation. */
export const PARSE_MODE_VALUES = Object.values(
  PARSE_MODES,
) as readonly ParseMode[];

/**
 * A Bot API chat identifier: either a numeric chat/user id or a public
 * `@username`/channel handle string.
 */
export type ChatId = number | string;

/** Convenience alias for a value that may be synchronous or a promise. */
export type Awaitable<T> = T | Promise<T>;
