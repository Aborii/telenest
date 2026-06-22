/**
 * @file src/lib/bot/retry.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the 429-aware retry helper: extracting `retry_after` from every
 * error shape, retrying only rate-limit errors, honoring the attempt budget and
 * delay cap, invoking the observer hook, and the real-timer default sleep.
 */

import { TelegramBotApiError } from '../common';
import {
  extractRetryAfterSeconds,
  withRetry,
  type RetryAttemptInfo,
} from './retry';

/** A sleep that records its delays instead of actually waiting. */
function recordingSleep(): {
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe('extractRetryAfterSeconds', () => {
  it('reads retryAfterSeconds off a wrapped TelegramBotApiError', () => {
    const error = new TelegramBotApiError('rate limited', {
      statusCode: 429,
      retryAfterSeconds: 7,
    });
    expect(extractRetryAfterSeconds(error)).toBe(7);
  });

  it('reads response.parameters.retry_after (Telegraf shape)', () => {
    const error = { response: { parameters: { retry_after: 3 } } };
    expect(extractRetryAfterSeconds(error)).toBe(3);
  });

  it('reads parameters.retry_after (plain Bot API shape)', () => {
    expect(extractRetryAfterSeconds({ parameters: { retry_after: 5 } })).toBe(
      5,
    );
  });

  it('reads a top-level retry_after', () => {
    expect(extractRetryAfterSeconds({ retry_after: 9 })).toBe(9);
  });

  it('returns undefined for non-rate-limit errors and non-objects', () => {
    expect(extractRetryAfterSeconds(new Error('boom'))).toBeUndefined();
    expect(extractRetryAfterSeconds(null)).toBeUndefined();
    expect(extractRetryAfterSeconds('nope')).toBeUndefined();
    expect(
      extractRetryAfterSeconds({ response: { parameters: {} } }),
    ).toBeUndefined();
  });

  it('ignores a negative or non-finite retry_after', () => {
    expect(extractRetryAfterSeconds({ retry_after: -1 })).toBeUndefined();
    expect(extractRetryAfterSeconds({ retry_after: NaN })).toBeUndefined();
  });
});

describe('withRetry', () => {
  it('returns immediately when fn succeeds on the first try', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('retries on a 429 and waits the reported retry_after (seconds → ms)', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { parameters: { retry_after: 2 } } })
      .mockResolvedValue('ok');

    await expect(withRetry(fn, { sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });

  it('rethrows a non-rate-limit error without retrying', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { sleep })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('throws the last error once retries are exhausted', async () => {
    const { sleep } = recordingSleep();
    const rateLimit = { retry_after: 1 };
    const fn = jest.fn().mockRejectedValue(rateLimit);

    await expect(withRetry(fn, { sleep, retries: 2 })).rejects.toBe(rateLimit);
    // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps the delay at maxDelayMs', async () => {
    const { sleep, delays } = recordingSleep();
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ retry_after: 60 })
      .mockResolvedValue('ok');

    await withRetry(fn, { sleep, maxDelayMs: 1500 });
    expect(delays).toEqual([1500]);
  });

  it('invokes onRetry before each back-off with attempt details', async () => {
    const { sleep } = recordingSleep();
    const info: RetryAttemptInfo[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ retry_after: 1 })
      .mockResolvedValue('ok');

    await withRetry(fn, { sleep, onRetry: (i) => info.push(i) });
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({ attempt: 1, delayMs: 1000 });
  });

  it('uses the real-timer default sleep when none is injected', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ retry_after: 0 })
      .mockResolvedValue('done');

    // retry_after 0 capped to 0ms keeps the real setTimeout path fast.
    await expect(withRetry(fn, { maxDelayMs: 0 })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
