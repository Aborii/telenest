/**
 * @file src/lib/bot/webhook/secret-token.ts
 *
 * PURPOSE
 * -------
 * Constant-time comparison for Telegram's webhook secret token. Verifying the
 * `X-Telegram-Bot-Api-Secret-Token` header with a naive `===` leaks information
 * through timing (an attacker can recover the secret byte-by-byte); this helper
 * compares in time independent of where the first mismatching byte falls.
 *
 * USAGE
 * -----
 * Internal to {@link import('./telegram-webhook.guard').TelegramWebhookGuard}.
 *
 * KEY EXPORTS
 * -----------
 * - timingSafeEqualSecret: Constant-time string equality for the secret token.
 * - generateWebhookSecret: Mints a cryptographically-random secret token.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mints a cryptographically-random webhook secret token suitable for
 * `setWebhook`'s `secret_token` and {@link TelegramBotWebhookOptions.secretToken}.
 *
 * The token is hex (`0-9a-f`), so it is always within Telegram's allowed charset
 * (`A-Z a-z 0-9 _ -`) and length (1–256). The default of 32 random bytes yields a
 * 64-character token with 256 bits of entropy.
 *
 * @param byteLength - Number of random bytes to draw (1–128); defaults to 32.
 * @returns A hex secret token, twice `byteLength` characters long.
 * @throws {RangeError} If `byteLength` is not an integer in the range 1–128.
 *
 * @example
 * ```ts
 * webhook: { path: '/tg', secretToken: generateWebhookSecret() }
 * ```
 */
export function generateWebhookSecret(byteLength = 32): string {
  // ── Bound the input: <1 yields an empty token; >128 would exceed 256 chars. ──
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > 128)
    throw new RangeError(
      `generateWebhookSecret byteLength must be an integer in 1..128, got ${byteLength}.`,
    );
  return randomBytes(byteLength).toString('hex');
}

/**
 * Compares the configured secret against the value received on the request, in
 * constant time.
 *
 * Both inputs are first hashed with SHA-256 to fixed-length (32-byte) digests
 * before the `timingSafeEqual` comparison. Hashing serves two purposes: it lets
 * `timingSafeEqual` run (it throws on length-mismatched buffers) and it hides the
 * secret's *length* from a timing observer, which a plain length check would
 * leak.
 *
 * @param expected - The secret token configured for this bot (never empty when
 *   called; an empty/unset secret is handled by the guard before reaching here).
 * @param actual - The token received in the request header, or `undefined` when
 *   the header was absent.
 * @returns `true` only when `actual` is a string equal to `expected`.
 * @throws Never.
 *
 * @example
 * ```ts
 * if (!timingSafeEqualSecret(options.secretToken, req.headers[HEADER]))
 *   throw new ForbiddenException();
 * ```
 */
export function timingSafeEqualSecret(
  expected: string,
  actual: string | undefined,
): boolean {
  // ── A missing header can never match a configured secret. ───────────────────
  if (typeof actual !== 'string') return false;

  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const actualDigest = createHash('sha256').update(actual, 'utf8').digest();

  // ── Equal-length digests, so timingSafeEqual compares without throwing. ──────
  return timingSafeEqual(expectedDigest, actualDigest);
}
