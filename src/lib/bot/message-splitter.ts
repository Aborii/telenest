/**
 * @file src/lib/bot/message-splitter.ts
 *
 * PURPOSE
 * -------
 * Splits a long string into Telegram-sized message chunks. The Bot API rejects
 * `sendMessage` text longer than 4096 UTF-16 code units, so any feature that
 * relays user- or machine-generated text (logs, transcripts, AI output) needs
 * to chunk it. This splitter prefers to break on line boundaries so formatting
 * survives, and falls back to a hard character split only for a single line
 * that is itself longer than the limit. It **never** emits a chunk longer than
 * the limit.
 *
 * USAGE
 * -----
 * ```ts
 * import { splitMessageText } from 'nestjs-telegram';
 *
 * for (const chunk of splitMessageText(hugeText)) {
 *   await bot.sendMessage(chatId, chunk);
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TELEGRAM_MESSAGE_MAX_LENGTH: The Bot API's 4096-code-unit text limit.
 * - splitMessageText: Split a string into ≤-limit chunks on line boundaries.
 */

/**
 * Telegram's maximum message text length, in UTF-16 code units (which is what
 * JavaScript's `String.prototype.length` counts, and how Telegram measures the
 * limit). Sourced from the Bot API spec for `sendMessage`.
 */
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

/**
 * Splits `text` into chunks that each fit within `limit` code units, preferring
 * to break on newline boundaries so multi-line formatting is preserved.
 *
 * A single line longer than `limit` (e.g. one enormous unbroken token) is
 * hard-split at the limit, since there is no boundary to break on. Empty input
 * yields an empty array (nothing to send), and no chunk is ever empty.
 *
 * @param text - The full message text to split.
 * @param limit - Maximum code units per chunk (defaults to the Bot API limit).
 * @returns An ordered array of chunks, each with `length <= limit`.
 * @throws {RangeError} If `limit` is not a positive integer.
 *
 * @example
 * ```ts
 * splitMessageText('a\nb', 4096); // ['a\nb']
 * splitMessageText('', 4096);     // []
 * ```
 */
export function splitMessageText(
  text: string,
  limit: number = TELEGRAM_MESSAGE_MAX_LENGTH,
): string[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('limit must be a positive integer.');

  // ── Fast paths: nothing to send, or it already fits in one message. ────────
  if (text.length === 0) return [];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = '';

  // ── Walk the lines, greedily packing as many as fit (with their newline
  //    separators) into each chunk before flushing. ─────────────────────────
  for (const line of text.split('\n')) {
    const candidate = current === '' ? line : `${current}\n${line}`;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    // The line does not fit onto the current chunk: flush what we have.
    if (current !== '') {
      chunks.push(current);
      current = '';
    }

    if (line.length <= limit) {
      // The line fits on its own — start a fresh chunk with it.
      current = line;
      continue;
    }

    // ── Pathological case: a single line longer than the limit. Hard-split it
    //    into limit-sized pieces; the trailing remainder seeds the next chunk
    //    so following lines can still pack onto it. ──────────────────────────
    let rest = line;
    while (rest.length > limit) {
      // Avoid cutting a surrogate pair in half: if the boundary lands right
      // after a high surrogate, back off one unit (but never to 0, so a
      // degenerate `limit` of 1 still makes progress).
      let end = limit;
      const lastCode = rest.charCodeAt(end - 1);
      if (lastCode >= 0xd800 && lastCode <= 0xdbff && end > 1) end -= 1;
      chunks.push(rest.slice(0, end));
      rest = rest.slice(end);
    }
    current = rest;
  }

  if (current !== '') chunks.push(current);
  return chunks;
}
