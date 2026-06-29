/**
 * @file src/lib/client/retry.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the client-side FLOOD_WAIT retry helper. They drive
 * {@link withClientRetry} with a fake operation and an injected `sleep` so no
 * real time passes and nothing touches the network, asserting the back-off,
 * attempt budget, delay cap, and the per-occurrence `onFloodWait` hook.
 */

import { TelegramAuthError, TelegramClientError } from '../common';
import {
  DEFAULT_CLIENT_RETRIES,
  extractClientRetryAfterSeconds,
  withClientRetry,
  type ClientFloodWaitInfo,
} from './retry';

/**
 * Builds a {@link TelegramClientError} carrying a flood-wait delay, as the
 * GramJS adapter surfaces for a rate-limited user operation.
 *
 * @param seconds - The flood-wait delay to record.
 * @returns A flood-wait client error.
 */
function floodClientError(seconds: number): TelegramClientError {
  return new TelegramClientError('rate limited', {
    operation: 'sendMessage',
    retryAfterSeconds: seconds,
  });
}

describe('extractClientRetryAfterSeconds', () => {
  it('reads the delay off a flood-wait TelegramClientError', () => {
    expect(extractClientRetryAfterSeconds(floodClientError(7))).toBe(7);
  });

  it('reads the delay off a FLOOD_WAIT TelegramAuthError', () => {
    const error = new TelegramAuthError('FLOOD_WAIT', undefined, {
      retryAfterSeconds: 12,
    });
    expect(extractClientRetryAfterSeconds(error)).toBe(12);
  });

  it('returns undefined for a client error without a flood-wait', () => {
    const error = new TelegramClientError('boom', { operation: 'getMe' });
    expect(extractClientRetryAfterSeconds(error)).toBeUndefined();
  });

  it('returns undefined for a plain error', () => {
    expect(extractClientRetryAfterSeconds(new Error('nope'))).toBeUndefined();
    expect(extractClientRetryAfterSeconds('nope')).toBeUndefined();
  });

  it('ignores negative / non-finite delays', () => {
    expect(
      extractClientRetryAfterSeconds(floodClientError(-1)),
    ).toBeUndefined();
    expect(
      extractClientRetryAfterSeconds(floodClientError(Number.NaN)),
    ).toBeUndefined();
    expect(
      extractClientRetryAfterSeconds(
        floodClientError(Number.POSITIVE_INFINITY),
      ),
    ).toBeUndefined();
  });
});

describe('withClientRetry', () => {
  /** A sleep spy that records requested delays without waiting. */
  function fakeSleep(): jest.Mock<Promise<void>, [number]> & {
    calls: number[];
  } {
    const calls: number[] = [];
    const fn = jest.fn(async (ms: number) => {
      calls.push(ms);
    }) as jest.Mock<Promise<void>, [number]> & { calls: number[] };
    fn.calls = calls;
    return fn;
  }

  it('returns the result without sleeping when the operation succeeds', async () => {
    const sleep = fakeSleep();
    const result = await withClientRetry(async () => 'ok', { sleep });
    expect(result).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits exactly the requested seconds, then retries and resolves', async () => {
    const sleep = fakeSleep();
    let calls = 0;
    const result = await withClientRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw floodClientError(3);
        return 'done';
      },
      { sleep },
    );
    expect(result).toBe('done');
    expect(calls).toBe(2);
    expect(sleep.calls).toEqual([3000]);
  });

  it('rethrows a non-flood error immediately without retrying', async () => {
    const sleep = fakeSleep();
    const op = jest.fn(async () => {
      throw new TelegramClientError('boom', { operation: 'getMe' });
    });
    await expect(withClientRetry(op, { sleep })).rejects.toThrow('boom');
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the retry budget and rethrows the last flood-wait', async () => {
    const sleep = fakeSleep();
    const op = jest.fn(async () => {
      throw floodClientError(2);
    });
    await expect(
      withClientRetry(op, { retries: 2, sleep }),
    ).rejects.toBeInstanceOf(TelegramClientError);
    // initial attempt + 2 retries = 3 calls.
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleep.calls).toEqual([2000, 2000]);
  });

  it('caps the back-off at maxDelayMs', async () => {
    const sleep = fakeSleep();
    let calls = 0;
    await withClientRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw floodClientError(600); // 600_000 ms uncapped
        return 'ok';
      },
      { sleep, maxDelayMs: 5000 },
    );
    expect(sleep.calls).toEqual([5000]);
  });

  it('fires onFloodWait for every occurrence, including the terminal one', async () => {
    const sleep = fakeSleep();
    const seen: ClientFloodWaitInfo[] = [];
    const op = jest.fn(async () => {
      throw floodClientError(1);
    });
    await expect(
      withClientRetry(op, {
        retries: 1,
        sleep,
        onFloodWait: (info) => seen.push(info),
      }),
    ).rejects.toBeInstanceOf(TelegramClientError);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      attempt: 1,
      willRetry: true,
      delayMs: 1000,
    });
    expect(seen[1]).toMatchObject({ attempt: 2, willRetry: false, delayMs: 0 });
  });

  it('defaults to DEFAULT_CLIENT_RETRIES retries', async () => {
    const sleep = fakeSleep();
    const op = jest.fn(async () => {
      throw floodClientError(1);
    });
    await expect(withClientRetry(op, { sleep })).rejects.toBeInstanceOf(
      TelegramClientError,
    );
    expect(op).toHaveBeenCalledTimes(DEFAULT_CLIENT_RETRIES + 1);
  });
});
