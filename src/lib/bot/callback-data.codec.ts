/**
 * @file src/lib/bot/callback-data.codec.ts
 *
 * PURPOSE
 * -------
 * A tiny, dependency-free codec for **structured inline-button callback data**.
 * Telegram caps `callback_data` at 64 **bytes**, which makes hand-rolling
 * `${action}:${id}` strings error-prone (it is easy to silently overflow and
 * get an opaque `400` at send time). These helpers JSON-encode an arbitrary
 * payload, validate the byte budget up-front, and decode it back with a
 * caller-supplied type — so the 64-byte rule fails fast and locally.
 *
 * USAGE
 * -----
 * ```ts
 * import { encodeCallbackData, decodeCallbackData } from 'nestjs-telegram';
 *
 * type Cb = { a: 'buy'; id: number };
 * const data = encodeCallbackData<Cb>({ a: 'buy', id: 42 }); // throws if > 64 bytes
 * // ...later, inside an `action` handler:
 * const payload = decodeCallbackData<Cb>(ctx.match.input);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - CALLBACK_DATA_MAX_BYTES: Telegram's hard 64-byte limit for `callback_data`.
 * - encodeCallbackData: Serialize a payload to a 64-byte-safe string.
 * - decodeCallbackData: Parse a string produced by {@link encodeCallbackData}.
 */

/**
 * Telegram's hard limit on the size of inline-button `callback_data`, in bytes
 * (UTF-8). Sourced from the Bot API spec for `InlineKeyboardButton`.
 */
export const CALLBACK_DATA_MAX_BYTES = 64;

/**
 * Serializes a structured payload into a Telegram-safe `callback_data` string.
 *
 * The payload is JSON-encoded and its UTF-8 byte length is validated against
 * {@link CALLBACK_DATA_MAX_BYTES} so an oversized payload is rejected here,
 * locally, rather than surfacing as an opaque Bot API `400` at send time.
 *
 * @typeParam T - The (JSON-serializable) payload shape.
 * @param payload - The value to encode; must be JSON-serializable.
 * @returns The encoded string, guaranteed to be ≤ 64 bytes.
 * @throws {RangeError} If the JSON encoding exceeds 64 bytes.
 * @throws {TypeError} If the payload cannot be JSON-serialized (e.g. a `BigInt`
 *   or a circular reference).
 *
 * @example
 * ```ts
 * const data = encodeCallbackData({ a: 'page', n: 3 });
 * new InlineKeyboardBuilder().callback('Next', data).build();
 * ```
 */
export function encodeCallbackData<T>(payload: T): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(payload);
  } catch (error) {
    // ── JSON.stringify throws on BigInt and circular references; re-surface it
    //    as a typed error with context rather than leaking the raw cause. ─────
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(
      `callback_data payload is not JSON-serializable: ${message}`,
    );
  }

  // ── `JSON.stringify` returns `undefined` for inputs like a bare `undefined`
  //    or a function; there is nothing safe to round-trip in that case. ───────
  if (encoded === undefined)
    throw new TypeError('callback_data payload serialized to `undefined`.');

  const bytes = Buffer.byteLength(encoded, 'utf8');
  if (bytes > CALLBACK_DATA_MAX_BYTES)
    throw new RangeError(
      `callback_data must be 1-${CALLBACK_DATA_MAX_BYTES} bytes; got ${bytes}.`,
    );

  return encoded;
}

/**
 * Parses a `callback_data` string produced by {@link encodeCallbackData} back
 * into a structured payload.
 *
 * The return type is supplied by the caller (`decodeCallbackData<MyType>(s)`):
 * the codec cannot know the runtime shape, so the generic documents the
 * caller's expectation — validate the result if it crosses a trust boundary.
 *
 * **Security: callback_data is NOT authenticated.** It is a plain JSON string
 * with no signature; while a user can only press buttons your bot sent, treat
 * the decoded value as untrusted input. Never embed an authorization fact in it
 * (e.g. a raw `userId`/`isAdmin`) and trust it on the way back — re-derive the
 * acting user from `ctx.from` and re-check permissions server-side.
 *
 * @typeParam T - The expected decoded payload shape (defaults to `unknown`).
 * @param data - The encoded string (typically `ctx.match.input`).
 * @returns The decoded payload, typed as `T`.
 * @throws {TypeError} If `data` is not valid JSON.
 *
 * @example
 * ```ts
 * type Cb = { a: 'page'; n: number };
 * const { n } = decodeCallbackData<Cb>(ctx.match.input);
 * ```
 */
export function decodeCallbackData<T = unknown>(data: string): T {
  try {
    return JSON.parse(data) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`callback_data is not valid JSON: ${message}`);
  }
}
