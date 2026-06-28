/**
 * @file src/lib/bot/callback-action.codec.ts
 *
 * PURPOSE
 * -------
 * A typed **callback-action envelope** layered over the 64-byte
 * {@link import('./callback-data.codec').encodeCallbackData} codec. Instead of
 * hand-rolling `${action}:${id}` strings and re-decoding/branching in every
 * `@Action` handler, an inline button's `callback_data` carries a small,
 * self-describing envelope `{ a: <key>, d?: <payload> }`:
 *
 * - `a` — the **action key** the {@link import('./updates/telegram-update.decorator').CallbackAction}
 *   router dispatches on, so each handler owns one key instead of decoding by hand.
 * - `d` — the (optional) structured payload, injected into a handler via
 *   {@link import('./updates/param.decorators').CallbackPayload} and optionally
 *   validated by a {@link CallbackActionSchema}.
 *
 * The envelope is still bound by Telegram's hard 64-byte `callback_data` limit;
 * encoding reuses the byte-budget check from the underlying codec, so an oversized
 * payload fails fast and locally rather than as an opaque Bot API `400`.
 *
 * USAGE
 * -----
 * ```ts
 * import { encodeCallbackAction } from 'telenest';
 *
 * // Build a button whose data routes to the 'buy' action with a typed payload:
 * const data = encodeCallbackAction('buy', { id: 42 }); // {"a":"buy","d":{"id":42}}
 * new InlineKeyboardBuilder().callback('Buy', data).build();
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - CALLBACK_ACTION_KEY_FIELD / CALLBACK_ACTION_DATA_FIELD: the envelope keys.
 * - CallbackActionEnvelope: the on-the-wire envelope shape.
 * - DecodedCallbackAction: the result of a successful {@link decodeCallbackAction}.
 * - CallbackActionSchema: a runtime validator/parser for a decoded payload.
 * - encodeCallbackAction: serialize a `{ key, payload }` pair to `callback_data`.
 * - decodeCallbackAction: safely parse `callback_data` back to `{ key, payload }`.
 */

import { encodeCallbackData } from './callback-data.codec';

/**
 * The envelope field holding the **action key** the router dispatches on. Kept to
 * a single character to preserve as much of the 64-byte budget as possible for the
 * payload.
 */
export const CALLBACK_ACTION_KEY_FIELD = 'a';

/**
 * The envelope field holding the (optional) structured **payload**. Single
 * character for the same byte-budget reason as {@link CALLBACK_ACTION_KEY_FIELD}.
 */
export const CALLBACK_ACTION_DATA_FIELD = 'd';

/**
 * The on-the-wire envelope serialized into a button's `callback_data`.
 *
 * @typeParam P - The (JSON-serializable) payload shape carried under `d`.
 */
export interface CallbackActionEnvelope<P = unknown> {
  /** The action key the router routes on (the {@link CALLBACK_ACTION_KEY_FIELD}). */
  readonly a: string;
  /**
   * The optional structured payload (the {@link CALLBACK_ACTION_DATA_FIELD});
   * omitted for key-only actions (e.g. a plain `Cancel` button).
   */
  readonly d?: P;
}

/**
 * The result of successfully decoding a callback-action envelope: the routing key
 * and the (still-untrusted) payload. Returned by {@link decodeCallbackAction};
 * `null` is returned instead for anything that is not a valid envelope.
 */
export interface DecodedCallbackAction {
  /** The action key extracted from the envelope's {@link CALLBACK_ACTION_KEY_FIELD}. */
  readonly key: string;
  /**
   * The decoded payload (the envelope's {@link CALLBACK_ACTION_DATA_FIELD}), or
   * `undefined` for a key-only action. Not validated — pass it through a
   * {@link CallbackActionSchema} before trusting its shape.
   */
  readonly payload: unknown;
}

/**
 * A runtime validator/parser for a decoded callback payload. Given the raw,
 * untrusted value decoded from the envelope, it returns the value typed as `T` or
 * **throws** when the value does not match the expected shape.
 *
 * The signature is intentionally a plain function so it composes with hand-written
 * guards and with schema libraries alike — e.g. `(v) => mySchema.parse(v)` for a
 * Zod schema — without this library taking a dependency on any of them.
 *
 * @typeParam T - The validated payload shape the parser guarantees on success.
 * @param value - The raw decoded payload (treat as untrusted).
 * @returns The same value, narrowed to `T`.
 * @throws Whatever the validator chooses to throw on an invalid payload; the
 *   thrown error is routed to the handler's exception filters by the registrar.
 */
export type CallbackActionSchema<T> = (value: unknown) => T;

/**
 * Serializes an action key and optional payload into a Telegram-safe
 * `callback_data` string of the form `{ a, d? }`.
 *
 * The envelope is JSON-encoded through {@link encodeCallbackData}, so the same
 * 64-byte UTF-8 budget is enforced here, locally, rather than surfacing as an
 * opaque Bot API `400` at send time. The `d` field is omitted entirely when no
 * payload is supplied, keeping key-only actions as small as possible.
 *
 * @typeParam P - The (JSON-serializable) payload shape.
 * @param key - The non-empty action key the router dispatches on.
 * @param payload - The optional structured payload to carry; omit for a key-only
 *   action.
 * @returns The encoded `callback_data` string, guaranteed to be ≤ 64 bytes.
 * @throws {TypeError} If `key` is empty, or the payload is not JSON-serializable.
 * @throws {RangeError} If the encoded envelope exceeds 64 bytes.
 *
 * @example
 * ```ts
 * encodeCallbackAction('page', { n: 3 }); // '{"a":"page","d":{"n":3}}'
 * encodeCallbackAction('cancel');         // '{"a":"cancel"}'
 * ```
 */
export function encodeCallbackAction<P>(key: string, payload?: P): string {
  // ── A blank key cannot be routed; reject it at the source. ──────────────────
  if (typeof key !== 'string' || key.length === 0)
    throw new TypeError('callback-action key must be a non-empty string.');

  // ── Only attach `d` when a payload was supplied so key-only actions stay
  //    free of a `"d":null` that would waste the byte budget. ─────────────────
  const envelope: CallbackActionEnvelope<P> =
    payload === undefined
      ? { [CALLBACK_ACTION_KEY_FIELD]: key }
      : { [CALLBACK_ACTION_KEY_FIELD]: key, [CALLBACK_ACTION_DATA_FIELD]: payload };

  return encodeCallbackData(envelope);
}

/**
 * Safely parses a `callback_data` string back into its action key and payload.
 *
 * Unlike {@link import('./callback-data.codec').decodeCallbackData}, this never
 * throws: anything that is not a well-formed envelope — non-JSON, a JSON value
 * that is not an object, or an object missing a non-empty string key — yields
 * `null`. That is what lets the router treat unknown, oversized, or legacy
 * (`action:id`) callback data as a non-match and simply ignore it, rather than
 * crashing on a stray button press.
 *
 * **Security: the payload is NOT authenticated.** As with the underlying codec,
 * treat `payload` as untrusted input — re-derive the acting user from `ctx.from`
 * and re-check permissions server-side; never trust an authorization fact carried
 * in the envelope.
 *
 * @param data - The raw `callback_data` string (typically `ctx.callbackQuery.data`).
 * @returns The decoded `{ key, payload }`, or `null` when `data` is not a valid
 *   callback-action envelope.
 * @throws Never.
 *
 * @example
 * ```ts
 * decodeCallbackAction('{"a":"page","d":{"n":3}}'); // { key: 'page', payload: { n: 3 } }
 * decodeCallbackAction('legacy:42');                // null
 * ```
 */
export function decodeCallbackAction(data: string): DecodedCallbackAction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // ── Not JSON at all (e.g. a legacy `action:id` string) — not our envelope. ─
    return null;
  }

  // ── Must be a plain object carrying a non-empty string action key. Arrays and
  //    primitives are rejected so only true envelopes route. ───────────────────
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return null;

  const record = parsed as Record<string, unknown>;
  const key = record[CALLBACK_ACTION_KEY_FIELD];
  if (typeof key !== 'string' || key.length === 0) return null;

  return { key, payload: record[CALLBACK_ACTION_DATA_FIELD] };
}
