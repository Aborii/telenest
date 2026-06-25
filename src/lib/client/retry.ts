/**
 * @file src/lib/client/retry.ts
 *
 * PURPOSE
 * -------
 * A focused retry helper for MTProto (user account) operations that honors
 * Telegram's `FLOOD_WAIT` back-pressure, mirroring the Bot side's
 * {@link import('../bot/retry').withRetry}. When Telegram rate-limits an
 * operation it reports the exact number of seconds to wait; the polite,
 * spec-compliant behavior is to sleep that long and try again. This helper wraps
 * any async client call, reads the wait off the typed error the GramJS adapter
 * surfaces ({@link TelegramClientError.retryAfterSeconds} /
 * {@link TelegramAuthError.retryAfterSeconds}), and retries up to a bounded
 * number of times. Errors **without** a flood-wait are rethrown immediately — it
 * only retries genuine rate-limit responses, never arbitrary failures.
 *
 * It is intentionally **opt-in**: a flood-wait is not retried unless the caller
 * wraps the operation in {@link withClientRetry} (or
 * {@link import('./telegram-user.service').TelegramUserService.withRetry}). This
 * keeps non-idempotent operations from being retried blindly — the caller
 * chooses which operations participate.
 *
 * USAGE
 * -----
 * ```ts
 * import { withClientRetry } from 'nestjs-telegram';
 *
 * // Retry a rate-limited send up to 5 times, waiting exactly as long as
 * // Telegram asks between attempts.
 * await withClientRetry(() => user.sendMessage('@channel', text), { retries: 5 });
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - ClientFloodWaitInfo: Observation passed to the `onFloodWait` hook.
 * - WithClientRetryOptions: Tuning knobs (attempts, delay cap, hook, sleep).
 * - extractClientRetryAfterSeconds: Read a flood-wait delay off an unknown error.
 * - withClientRetry: Run an async fn, retrying on FLOOD_WAIT.
 */

import { TelegramAuthError, TelegramClientError } from '../common';

/**
 * Information passed to {@link WithClientRetryOptions.onFloodWait} on **every**
 * observed `FLOOD_WAIT` — whether or not a retry follows — so callers can
 * observe rate-limits (e.g. bump a metric or log) without re-detecting them.
 */
export interface ClientFloodWaitInfo {
  /** 1-based count of flood-waits seen so far (this occurrence included). */
  attempt: number;
  /** The delay in seconds Telegram requested for this occurrence. */
  retryAfterSeconds: number;
  /** `true` when the helper will retry; `false` when the budget is exhausted. */
  willRetry: boolean;
  /** Milliseconds about to be slept (`0` when `willRetry` is `false`). */
  delayMs: number;
  /** The flood-wait error that triggered this occurrence. */
  error: unknown;
}

/**
 * Tuning options for {@link withClientRetry}.
 */
export interface WithClientRetryOptions {
  /**
   * Maximum number of **retries** after the initial attempt (so total attempts
   * are `retries + 1`). Defaults to {@link DEFAULT_CLIENT_RETRIES}.
   */
  retries?: number;
  /**
   * Upper bound, in milliseconds, on any single back-off wait. Telegram's
   * flood-wait is normally small, but this caps a pathological value so a call
   * cannot hang for minutes. Omit for no cap.
   */
  maxDelayMs?: number;
  /**
   * Observer invoked on every flood-wait occurrence (retried or terminal),
   * before the back-off wait. Used by the user service to increment the
   * `FLOOD_WAITS` metric.
   */
  onFloodWait?: (info: ClientFloodWaitInfo) => void;
  /**
   * Sleep implementation, injectable for tests. Defaults to a real
   * `setTimeout`-based delay.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Default number of retries when {@link WithClientRetryOptions.retries} is omitted. */
export const DEFAULT_CLIENT_RETRIES = 2;

/** Real wall-clock sleep used when no custom `sleep` is supplied. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads Telegram's flood-wait delay (seconds) off an unknown thrown value.
 *
 * Only this library's typed errors carry the delay: the GramJS adapter extracts
 * `FLOOD_WAIT_<n>` behind the {@link import('./gram-client.interface').IGramClient}
 * seam and records it on {@link TelegramClientError.retryAfterSeconds} (user
 * operations) or {@link TelegramAuthError.retryAfterSeconds} (the sign-in flow).
 * Any other value — or a typed error that is not a flood-wait — yields
 * `undefined`, so non-rate-limit failures are never treated as retryable.
 *
 * @param error - The caught value to inspect.
 * @returns The retry delay in seconds, or `undefined` if this is not a
 *   flood-wait carrying a non-negative, finite delay.
 * @throws Never.
 */
export function extractClientRetryAfterSeconds(
  error: unknown,
): number | undefined {
  if (
    error instanceof TelegramClientError ||
    error instanceof TelegramAuthError
  ) {
    const seconds = error.retryAfterSeconds;
    return typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds >= 0
      ? seconds
      : undefined;
  }
  return undefined;
}

/**
 * Runs `fn`, retrying it when it rejects with a Telegram `FLOOD_WAIT` carrying a
 * delay. Between attempts it sleeps for exactly that many seconds (capped by
 * {@link WithClientRetryOptions.maxDelayMs} when set). Any error **without** a
 * flood-wait, and the final flood-wait once retries are exhausted, propagates to
 * the caller unchanged.
 *
 * @typeParam T - The resolved result type of `fn`.
 * @param fn - The async client operation to run.
 * @param options - Retry tuning; see {@link WithClientRetryOptions}.
 * @returns The resolved value of `fn`.
 * @throws The original error if it is not a flood-wait, or the last flood-wait
 *   error after all retries are exhausted.
 *
 * @example
 * ```ts
 * await withClientRetry(() => user.sendMessage('me', text), { retries: 5 });
 * ```
 */
export async function withClientRetry<T>(
  fn: () => Promise<T>,
  options?: WithClientRetryOptions,
): Promise<T> {
  const retries = options?.retries ?? DEFAULT_CLIENT_RETRIES;
  const sleep = options?.sleep ?? defaultSleep;

  let attempt = 0;
  // ── Loop until `fn` resolves, a non-flood error is thrown, or retries run out.
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const retryAfter = extractClientRetryAfterSeconds(error);

      // Not a flood-wait: surface it unchanged.
      if (retryAfter === undefined) throw error;

      attempt += 1;
      const willRetry = attempt <= retries;
      let delayMs = willRetry ? retryAfter * 1000 : 0;
      if (willRetry && options?.maxDelayMs !== undefined)
        delayMs = Math.min(delayMs, options.maxDelayMs);

      // ── Observe every flood-wait (retried or terminal) before acting. ────────
      options?.onFloodWait?.({
        attempt,
        retryAfterSeconds: retryAfter,
        willRetry,
        delayMs,
        error,
      });

      // No budget left: surface the flood-wait unchanged.
      if (!willRetry) throw error;
      await sleep(delayMs);
    }
  }
}
