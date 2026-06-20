/**
 * @file src/lib/bot/web-app/validate-web-app-init-data.ts
 *
 * PURPOSE
 * -------
 * Server-side validation of the `initData` string a Telegram **Mini App (Web
 * App)** sends to your backend, following Telegram's documented HMAC-SHA256
 * scheme. This is the only way to trust a Mini App user's identity on the
 * server. Pure and dependency-free (Node's `crypto` only) — no network, no SDK.
 *
 * Algorithm (per core.telegram.org/bots/webapps#validating-data):
 *   secret_key   = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   data_check   = sorted "key=value" lines, excluding `hash` and `signature`
 *   valid        = timingSafeEqual(HMAC_SHA256(key = secret_key, data_check), hash)
 *
 * USAGE
 * -----
 * ```ts
 * const data = validateWebAppInitData(req.body.initData, process.env.BOT_TOKEN!, {
 *   maxAgeSeconds: 3600,
 * });
 * if (!data) throw new UnauthorizedException();
 * const userId = data.user?.id;
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - validateWebAppInitData: validates + parses Mini App init data.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { TelegramConfigError } from '../../common';
import {
  WEB_APP_CHAT_TYPE_VALUES,
  type ValidateWebAppInitDataOptions,
  type WebAppChat,
  type WebAppChatType,
  type WebAppInitData,
  type WebAppUser,
} from './web-app.types';

/** The fixed HMAC key Telegram uses to derive the per-bot secret key. */
const SECRET_KEY_SALT = 'WebAppData';

/** Fields excluded from the data-check-string (Telegram signs everything else). */
const EXCLUDED_FIELDS: ReadonlySet<string> = new Set(['hash', 'signature']);

/**
 * Validates and parses Telegram Mini App `initData`.
 *
 * @param initData - The raw `initData` query string sent by the Mini App.
 * @param botToken - The bot token whose Mini App produced the data.
 * @param options - Optional freshness check (see {@link ValidateWebAppInitDataOptions}).
 * @returns The parsed, typed data when the signature is valid and (if requested)
 *   fresh; `null` when the signature does not match or the data is expired.
 * @throws {TelegramConfigError} When `botToken` is empty, or `initData` is
 *   structurally malformed (missing `hash`, bad `auth_date`, or unparseable
 *   `user`/`receiver`/`chat` JSON).
 *
 * @example
 * ```ts
 * const data = validateWebAppInitData(initData, token);
 * if (data) console.log('verified user', data.user?.id);
 * ```
 */
export function validateWebAppInitData(
  initData: string,
  botToken: string,
  options: ValidateWebAppInitDataOptions = {},
): WebAppInitData | null {
  if (!botToken)
    throw new TelegramConfigError(
      'validateWebAppInitData: a non-empty botToken is required.',
    );

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash)
    throw new TelegramConfigError(
      'validateWebAppInitData: initData is missing the required "hash" field.',
    );

  // ── Build the data-check-string: every field except hash/signature, sorted
  //    alphabetically, "key=value" joined by newlines. ──────────────────────
  const dataCheckString = [...params.entries()]
    .filter(([key]) => !EXCLUDED_FIELDS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', SECRET_KEY_SALT)
    .update(botToken)
    .digest();
  const computed = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();

  // ── Constant-time comparison; a malformed/mismatched hash fails closed. ────
  if (!hashMatches(computed, hash)) return null;

  const data = buildInitData(params, hash);

  // ── Optional freshness check against auth_date. ───────────────────────────
  if (options.maxAgeSeconds !== undefined) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const authSeconds = Math.floor(data.authDate.getTime() / 1000);
    if (nowSeconds - authSeconds > options.maxAgeSeconds) return null;
  }

  return data;
}

/**
 * Constant-time comparison of a computed digest against the received hex hash.
 *
 * @param computed - The freshly computed HMAC digest (raw bytes).
 * @param hashHex - The `hash` field from initData (hex string).
 * @returns `true` only when the hash is well-formed and matches.
 * @throws Never.
 */
function hashMatches(computed: Buffer, hashHex: string): boolean {
  // ── A digest is 32 bytes / 64 hex chars; reject anything else before
  //    decoding so timingSafeEqual never sees mismatched lengths. ────────────
  if (!/^[0-9a-fA-F]{64}$/.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  return (
    expected.length === computed.length && timingSafeEqual(expected, computed)
  );
}

/**
 * Parses the validated params into a typed {@link WebAppInitData}.
 *
 * @param params - The parsed initData fields (signature already verified).
 * @param hash - The verified hash to echo back on the result.
 * @returns The typed payload.
 * @throws {TelegramConfigError} When `auth_date` or any embedded JSON is invalid.
 */
function buildInitData(params: URLSearchParams, hash: string): WebAppInitData {
  const authDateRaw = params.get('auth_date');
  const authSeconds = authDateRaw === null ? Number.NaN : Number(authDateRaw);
  if (!Number.isFinite(authSeconds))
    throw new TelegramConfigError(
      'validateWebAppInitData: "auth_date" is missing or not a number.',
    );

  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) raw[key] = value;

  return {
    user: parseUser(params.get('user'), 'user'),
    receiver: parseUser(params.get('receiver'), 'receiver'),
    chat: parseChat(params.get('chat')),
    chatType: params.get('chat_type') ?? undefined,
    chatInstance: params.get('chat_instance') ?? undefined,
    queryId: params.get('query_id') ?? undefined,
    startParam: params.get('start_param') ?? undefined,
    canSendAfter: parseOptionalInt(params.get('can_send_after')),
    authDate: new Date(authSeconds * 1000),
    hash,
    signature: params.get('signature') ?? undefined,
    raw,
  };
}

/**
 * Parses a `user`/`receiver` JSON blob into a {@link WebAppUser}.
 *
 * @param json - The raw JSON string, or `null` when the field is absent.
 * @param field - Field name, for error messages.
 * @returns The typed user, or `undefined` when absent.
 * @throws {TelegramConfigError} When the JSON is invalid or missing required keys.
 */
function parseUser(json: string | null, field: string): WebAppUser | undefined {
  if (json === null) return undefined;
  const obj = asObject(parseJson(json, field), field);
  return {
    id: requireNumber(obj.id, `${field}.id`),
    isBot: asBoolean(obj.is_bot),
    firstName: requireString(obj.first_name, `${field}.first_name`),
    lastName: asString(obj.last_name),
    username: asString(obj.username),
    languageCode: asString(obj.language_code),
    isPremium: asBoolean(obj.is_premium),
    addedToAttachmentMenu: asBoolean(obj.added_to_attachment_menu),
    allowsWriteToPm: asBoolean(obj.allows_write_to_pm),
    photoUrl: asString(obj.photo_url),
  };
}

/**
 * Parses a `chat` JSON blob into a {@link WebAppChat}.
 *
 * @param json - The raw JSON string, or `null` when absent.
 * @returns The typed chat, or `undefined` when absent.
 * @throws {TelegramConfigError} When the JSON is invalid or the type is unknown.
 */
function parseChat(json: string | null): WebAppChat | undefined {
  if (json === null) return undefined;
  const obj = asObject(parseJson(json, 'chat'), 'chat');
  return {
    id: requireNumber(obj.id, 'chat.id'),
    type: requireChatType(obj.type),
    title: requireString(obj.title, 'chat.title'),
    username: asString(obj.username),
    photoUrl: asString(obj.photo_url),
  };
}

// ── Narrowing helpers (contain all `unknown` handling in one place) ──────────

/**
 * Parses a JSON string, attributing failures to a named field.
 *
 * @param json - The JSON text.
 * @param field - Field name, for error messages.
 * @returns The parsed value (`unknown`).
 * @throws {TelegramConfigError} When parsing fails.
 */
function parseJson(json: string, field: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new TelegramConfigError(
      `validateWebAppInitData: "${field}" is not valid JSON.`,
    );
  }
}

/**
 * Asserts a value is a plain object and returns it as a property bag.
 *
 * @param value - The value to check.
 * @param field - Field name, for error messages.
 * @returns The value typed as `Record<string, unknown>`.
 * @throws {TelegramConfigError} When the value is not a non-array object.
 */
function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TelegramConfigError(
      `validateWebAppInitData: "${field}" is not a JSON object.`,
    );
  return value as Record<string, unknown>;
}

/** Returns `value` when it is a string, else `undefined`. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Returns `value` when it is a finite number, else `undefined`. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Returns `value` when it is a boolean, else `undefined`. */
function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Requires a string field.
 *
 * @param value - The candidate value.
 * @param field - Field name, for error messages.
 * @returns The string.
 * @throws {TelegramConfigError} When `value` is not a string.
 */
function requireString(value: unknown, field: string): string {
  const result = asString(value);
  if (result === undefined)
    throw new TelegramConfigError(
      `validateWebAppInitData: "${field}" is missing or not a string.`,
    );
  return result;
}

/**
 * Requires a numeric field.
 *
 * @param value - The candidate value.
 * @param field - Field name, for error messages.
 * @returns The number.
 * @throws {TelegramConfigError} When `value` is not a finite number.
 */
function requireNumber(value: unknown, field: string): number {
  const result = asNumber(value);
  if (result === undefined)
    throw new TelegramConfigError(
      `validateWebAppInitData: "${field}" is missing or not a number.`,
    );
  return result;
}

/**
 * Requires a known {@link WebAppChatType}.
 *
 * @param value - The candidate value.
 * @returns The validated chat type.
 * @throws {TelegramConfigError} When `value` is not a recognised chat type.
 */
function requireChatType(value: unknown): WebAppChatType {
  const result = asString(value);
  if (
    result === undefined ||
    !WEB_APP_CHAT_TYPE_VALUES.includes(result as WebAppChatType)
  )
    throw new TelegramConfigError(
      `validateWebAppInitData: "chat.type" is missing or unrecognised.`,
    );
  // ── Membership checked above, so the narrowing assertion is sound. ─────────
  return result as WebAppChatType;
}

/**
 * Parses an optional integer query field.
 *
 * @param value - The raw string value, or `null`.
 * @returns The integer, or `undefined` when absent/non-numeric.
 * @throws Never.
 */
function parseOptionalInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
