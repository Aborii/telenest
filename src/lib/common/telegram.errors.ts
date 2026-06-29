/**
 * @file src/lib/common/telegram.errors.ts
 *
 * PURPOSE
 * -------
 * Typed error hierarchy shared by the Bot API and MTProto (user account)
 * sides of the Telegram module. Every failure surfaced by this library is an
 * instance of {@link TelegramError}, so consumers can `catch` a single base
 * type and still narrow to a precise cause via the discriminated `code` field.
 *
 * USAGE
 * -----
 * ```ts
 * import { TelegramAuthError, isTelegramError } from 'telenest';
 *
 * try {
 *   await auth.signIn({ phoneCode: '00000', ... });
 * } catch (error) {
 *   if (isTelegramError(error) && error.code === 'PASSWORD_REQUIRED') {
 *     // prompt the user for their 2FA password
 *   }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - TelegramError: Abstract base for every error thrown by this library.
 * - TelegramConfigError: Invalid or missing module configuration.
 * - TelegramBotApiError: A Bot API (HTTP) request failed.
 * - TelegramClientError: A generic MTProto client failure.
 * - TelegramAuthError: A failure during the user-account sign-in flow.
 * - TelegramSessionError: A session could not be loaded or persisted.
 * - TELEGRAM_AUTH_ERROR_CODES / TelegramAuthErrorCode: Closed set of auth codes.
 * - isTelegramError: Type guard for narrowing `unknown` caught values.
 */

/**
 * Closed set of machine-readable codes attached to {@link TelegramAuthError}.
 *
 * Modeled as an `as const` record (never a TS `enum`, per repo conventions) so
 * the union type {@link TelegramAuthErrorCode} can be derived from it.
 */
export const TELEGRAM_AUTH_ERROR_CODES = {
  /** The supplied phone number was rejected by Telegram. */
  PHONE_INVALID: 'PHONE_INVALID',
  /** The login code was empty, expired, or rejected by Telegram. */
  CODE_INVALID: 'CODE_INVALID',
  /** Sign-in succeeded up to the point where a 2FA password is required. */
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  /** The supplied 2FA password was rejected by Telegram. */
  PASSWORD_INVALID: 'PASSWORD_INVALID',
  /** `signIn` was called before `sendCode` produced a `phoneCodeHash`. */
  CODE_NOT_REQUESTED: 'CODE_NOT_REQUESTED',
  /** Telegram requires the account to finish sign-up (no existing account). */
  SIGN_UP_REQUIRED: 'SIGN_UP_REQUIRED',
  /** An operation needs an authorized session but none is active. */
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  /** Telegram imposed a flood-wait; retry after the delay it reported. */
  FLOOD_WAIT: 'FLOOD_WAIT',
  /** Any auth failure that does not map to a more specific code. */
  UNKNOWN: 'UNKNOWN',
} as const;

/** Union of every auth error code understood by this library. */
export type TelegramAuthErrorCode =
  (typeof TELEGRAM_AUTH_ERROR_CODES)[keyof typeof TELEGRAM_AUTH_ERROR_CODES];

/** Readonly array form of {@link TELEGRAM_AUTH_ERROR_CODES} for validation. */
export const TELEGRAM_AUTH_ERROR_CODE_VALUES = Object.values(
  TELEGRAM_AUTH_ERROR_CODES,
) as readonly TelegramAuthErrorCode[];

/**
 * Discriminator tags placed on the `kind` field of each error subclass. They
 * allow exhaustive `switch` narrowing without relying on `instanceof`.
 */
export const TELEGRAM_ERROR_KINDS = {
  /** {@link TelegramConfigError}. */
  CONFIG: 'config',
  /** {@link TelegramBotApiError}. */
  BOT_API: 'bot-api',
  /** {@link TelegramClientError}. */
  CLIENT: 'client',
  /** {@link TelegramAuthError}. */
  AUTH: 'auth',
  /** {@link TelegramSessionError}. */
  SESSION: 'session',
} as const;

/** Union of the discriminator tags in {@link TELEGRAM_ERROR_KINDS}. */
export type TelegramErrorKind =
  (typeof TELEGRAM_ERROR_KINDS)[keyof typeof TELEGRAM_ERROR_KINDS];

/**
 * Abstract base class for every error raised by this library.
 *
 * Subclasses set a stable {@link TelegramErrorKind} discriminator so callers
 * can branch on `error.kind` without importing each concrete class.
 */
export abstract class TelegramError extends Error {
  /** Stable discriminator identifying which subsystem raised the error. */
  public abstract readonly kind: TelegramErrorKind;

  /**
   * The original error that triggered this one, if any. Preserved so the root
   * cause is never lost when we wrap third-party (Telegraf / GramJS) failures.
   */
  public readonly cause?: unknown;

  /**
   * @param message - Human-readable description of what went wrong.
   * @param cause - Underlying error that was wrapped, if any.
   */
  protected constructor(message: string, cause?: unknown) {
    super(message);
    // ── Restore the prototype chain (required when targeting ES5/ES2015+ with
    //    `extends Error`, otherwise `instanceof` checks fail). ───────────────
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.cause = cause;
  }
}

/**
 * Thrown when module options are missing or structurally invalid (for example
 * an empty bot token, or a non-numeric `apiId`). These are programmer errors
 * surfaced at bootstrap rather than runtime API failures.
 */
export class TelegramConfigError extends TelegramError {
  /** {@inheritDoc TelegramError.kind} */
  public readonly kind = TELEGRAM_ERROR_KINDS.CONFIG;

  /**
   * @param message - Description of the misconfiguration.
   * @param cause - Underlying error, if this wraps another failure.
   */
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/**
 * Thrown when a Bot API (HTTP) request fails. Carries Telegram's numeric
 * `error_code` and `description` when they could be extracted from the
 * underlying Telegraf error.
 */
export class TelegramBotApiError extends TelegramError {
  /** {@inheritDoc TelegramError.kind} */
  public readonly kind = TELEGRAM_ERROR_KINDS.BOT_API;

  /** Telegram's numeric error code (e.g. 400, 403, 429), when known. */
  public readonly statusCode?: number;

  /** The Bot API method that was being called (e.g. `sendMessage`). */
  public readonly method?: string;

  /**
   * Seconds to wait before retrying, present only when Telegram returned a
   * `429 Too Many Requests` carrying a `retry_after` parameter. Consumed by the
   * library's retry helper to back off for exactly the requested interval.
   */
  public readonly retryAfterSeconds?: number;

  /**
   * @param message - Description of the failure.
   * @param options - Optional Telegram status code, method name, flood-wait
   *   delay, and underlying cause.
   */
  public constructor(
    message: string,
    options?: {
      statusCode?: number;
      method?: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause);
    this.statusCode = options?.statusCode;
    this.method = options?.method;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/**
 * Thrown for generic MTProto client failures that are not part of the auth
 * flow (for example a failed `getDialogs` or transport error).
 */
export class TelegramClientError extends TelegramError {
  /** {@inheritDoc TelegramError.kind} */
  public readonly kind = TELEGRAM_ERROR_KINDS.CLIENT;

  /** The client operation that failed (e.g. `getDialogs`), when known. */
  public readonly operation?: string;

  /**
   * Seconds to wait before retrying, present only when the failure is a
   * Telegram `FLOOD_WAIT` rate-limit. Populated by the GramJS adapter (which
   * confines the SDK's error shape) and consumed by the client retry helper
   * ({@link import('../client/retry').withClientRetry}) to back off for exactly
   * the requested interval.
   */
  public readonly retryAfterSeconds?: number;

  /**
   * @param message - Description of the failure.
   * @param options - Optional operation name, flood-wait delay, and underlying
   *   cause.
   */
  public constructor(
    message: string,
    options?: {
      operation?: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause);
    this.operation = options?.operation;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/**
 * Thrown during the user-account sign-in flow. The {@link TelegramAuthErrorCode}
 * lets callers drive a state machine (request code → enter code → enter 2FA).
 */
export class TelegramAuthError extends TelegramError {
  /** {@inheritDoc TelegramError.kind} */
  public readonly kind = TELEGRAM_ERROR_KINDS.AUTH;

  /** Machine-readable reason the sign-in step failed. */
  public readonly code: TelegramAuthErrorCode;

  /** Seconds to wait before retrying, present only when `code` is FLOOD_WAIT. */
  public readonly retryAfterSeconds?: number;

  /**
   * @param code - Machine-readable auth failure code.
   * @param message - Human-readable description (defaults to the code).
   * @param options - Optional flood-wait delay and underlying cause.
   */
  public constructor(
    code: TelegramAuthErrorCode,
    message?: string,
    options?: { retryAfterSeconds?: number; cause?: unknown },
  ) {
    super(message ?? `Telegram authentication failed: ${code}`, options?.cause);
    this.code = code;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/**
 * Thrown when a session string cannot be loaded from or persisted to the
 * configured {@link import('../client/session/session-store.interface').SessionStore}.
 */
export class TelegramSessionError extends TelegramError {
  /** {@inheritDoc TelegramError.kind} */
  public readonly kind = TELEGRAM_ERROR_KINDS.SESSION;

  /**
   * @param message - Description of the storage failure.
   * @param cause - Underlying error (e.g. a filesystem error), if any.
   */
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/**
 * Type guard that narrows an `unknown` caught value to {@link TelegramError}.
 *
 * @param value - The value to test (typically a caught `error`).
 * @returns `true` when `value` is one of this library's error instances.
 * @throws Never.
 *
 * @example
 * ```ts
 * try { await bot.sendMessage(id, text); }
 * catch (error) {
 *   if (isTelegramError(error)) console.error(error.kind, error.message);
 * }
 * ```
 */
export function isTelegramError(value: unknown): value is TelegramError {
  return value instanceof TelegramError;
}
