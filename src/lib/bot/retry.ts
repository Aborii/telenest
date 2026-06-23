/**
 * @file src/lib/bot/retry.ts
 *
 * PURPOSE
 * -------
 * A focused retry helper that honors Telegram's `429 Too Many Requests`
 * back-pressure. When the Bot API rate-limits a call it returns a `retry_after`
 * value (seconds); the polite, spec-compliant behavior is to wait exactly that
 * long and try again. This helper wraps any async Bot API call, extracts
 * `retry_after` from whichever shape the error takes (a wrapped
 * {@link TelegramBotApiError}, or a raw Telegraf/Bot API error), and retries up
 * to a bounded number of times. Errors **without** a `retry_after` are rethrown
 * immediately — it only retries genuine rate-limit responses, never arbitrary
 * failures.
 *
 * USAGE
 * -----
 * ```ts
 * import { withRetry } from 'nestjs-telegram';
 *
 * await withRetry(() => bot.sendMessage(chatId, text));
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - WithRetryOptions: Tuning knobs (attempts, delay cap, hooks, sleep).
 * - extractRetryAfterSeconds: Pull `retry_after` out of an unknown error.
 * - withRetry: Run an async fn, retrying on 429 `retry_after`.
 */

import { TelegramBotApiError } from '../common';

/**
 * Information passed to the {@link WithRetryOptions.onRetry} hook before each
 * back-off wait, so callers can log/observe rate-limit retries.
 */
export interface RetryAttemptInfo {
  /** 1-based index of the retry about to be performed. */
  attempt: number;
  /** Milliseconds this helper is about to sleep before retrying. */
  delayMs: number;
  /** The rate-limit error that triggered this retry. */
  error: unknown;
}

/**
 * Tuning options for {@link withRetry}.
 */
export interface WithRetryOptions {
  /**
   * Maximum number of **retries** after the initial attempt (so total attempts
   * are `retries + 1`). Defaults to `2`.
   */
  retries?: number;
  /**
   * Upper bound, in milliseconds, on any single back-off wait. Telegram's
   * `retry_after` is normally small, but this caps a pathological value so a
   * call cannot hang for minutes. Omit for no cap.
   */
  maxDelayMs?: number;
  /** Optional observer invoked just before each back-off wait. */
  onRetry?: (info: RetryAttemptInfo) => void;
  /**
   * Sleep implementation, injectable for tests. Defaults to a real
   * `setTimeout`-based delay.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Default number of retries when {@link WithRetryOptions.retries} is omitted. */
const DEFAULT_RETRIES = 2;

/** Real wall-clock sleep used when no custom `sleep` is supplied. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads a non-negative number from an unknown property without assuming `any`.
 *
 * @param source - The object to probe.
 * @param key - The property name to read.
 * @returns The numeric value if present and finite & non-negative, else `undefined`.
 * @throws Never.
 */
function readRetryAfter(source: unknown, key: string): number | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Extracts Telegram's `retry_after` (seconds) from an unknown thrown value,
 * probing every shape it can take across this library and Telegraf:
 *
 * - a wrapped {@link TelegramBotApiError} (`.retryAfterSeconds`),
 * - a raw Telegraf error (`.response.parameters.retry_after`),
 * - a plain Bot API error object (`.parameters.retry_after` or `.retry_after`).
 *
 * @param error - The caught value to inspect.
 * @returns The retry delay in seconds, or `undefined` if this is not a
 *   rate-limit error carrying `retry_after`.
 * @throws Never.
 */
export function extractRetryAfterSeconds(error: unknown): number | undefined {
  if (error instanceof TelegramBotApiError) return error.retryAfterSeconds;

  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as {
    response?: { parameters?: unknown };
    parameters?: unknown;
  };

  return (
    readRetryAfter(candidate.response?.parameters, 'retry_after') ??
    readRetryAfter(candidate.parameters, 'retry_after') ??
    readRetryAfter(candidate, 'retry_after')
  );
}

/**
 * Runs `fn`, retrying it when it rejects with a Telegram `429` carrying a
 * `retry_after`. Between attempts it sleeps for exactly `retry_after` seconds
 * (capped by {@link WithRetryOptions.maxDelayMs} when set). Any error **without**
 * a `retry_after`, and the final error once retries are exhausted, propagates
 * to the caller unchanged.
 *
 * @typeParam T - The resolved result type of `fn`.
 * @param fn - The async operation to run (typically a Bot API call).
 * @param options - Retry tuning; see {@link WithRetryOptions}.
 * @returns The resolved value of `fn`.
 * @throws The original error if it is not a rate-limit error, or the last
 *   rate-limit error after all retries are exhausted.
 *
 * @example
 * ```ts
 * await withRetry(() => bot.sendMessage(id, text), { retries: 5 });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: WithRetryOptions,
): Promise<T> {
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const sleep = options?.sleep ?? defaultSleep;

  let attempt = 0;
  // ── Loop until `fn` resolves, a non-429 error is thrown, or retries run out.
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const retryAfter = extractRetryAfterSeconds(error);

      // Not a rate-limit error, or no budget left: surface it unchanged.
      if (retryAfter === undefined || attempt >= retries) throw error;

      attempt += 1;
      let delayMs = retryAfter * 1000;
      if (options?.maxDelayMs !== undefined)
        delayMs = Math.min(delayMs, options.maxDelayMs);

      options?.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
