/**
 * @file src/lib/client/telegram-user.retry.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link TelegramUserService.withRetry}: that it applies the
 * module-level FLOOD_WAIT retry defaults, honors per-call overrides, increments
 * the account's `FLOOD_WAITS` metric on every occurrence, and leaves non-flood
 * failures untouched. A fake client and an injected `sleep` keep it off the
 * network and out of real time.
 */

import { InMemoryTelegramMetrics, TelegramClientError } from '../common';
import { createMockGramClient } from '../testing/mock-gram-client';
import { TelegramUserService } from './telegram-user.service';

/** A flood-wait client error, as the adapter surfaces for a rate-limited op. */
function floodError(seconds: number): TelegramClientError {
  return new TelegramClientError('rate limited', {
    operation: 'sendMessage',
    retryAfterSeconds: seconds,
  });
}

/** A `sleep` that resolves immediately so no real time passes. */
const noWait = async (): Promise<void> => undefined;

describe('TelegramUserService.withRetry', () => {
  it('retries a flooded operation and increments FLOOD_WAITS per occurrence', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const service = new TelegramUserService(createMockGramClient(), metrics);

    let calls = 0;
    const result = await service.withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw floodError(2);
        return 'ok';
      },
      { sleep: noWait },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(2);
    // One flood-wait was observed (the retried one).
    expect(metrics.snapshot().floodWaits).toBe(1);
  });

  it('applies the module-level retry defaults', async () => {
    const metrics = new InMemoryTelegramMetrics();
    // retries: 1 => initial attempt + 1 retry = 2 calls, 2 flood-waits observed.
    const service = new TelegramUserService(
      createMockGramClient(),
      metrics,
      0,
      {
        retries: 1,
      },
    );

    const op = jest.fn(async () => {
      throw floodError(1);
    });
    await expect(
      service.withRetry(op, { sleep: noWait }),
    ).rejects.toBeInstanceOf(TelegramClientError);

    expect(op).toHaveBeenCalledTimes(2);
    expect(metrics.snapshot().floodWaits).toBe(2);
  });

  it('lets per-call options override the module defaults', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const service = new TelegramUserService(
      createMockGramClient(),
      metrics,
      0,
      {
        retries: 5,
      },
    );

    const op = jest.fn(async () => {
      throw floodError(1);
    });
    // Per-call retries: 0 wins over the module's 5 => a single attempt.
    await expect(
      service.withRetry(op, { retries: 0, sleep: noWait }),
    ).rejects.toBeInstanceOf(TelegramClientError);

    expect(op).toHaveBeenCalledTimes(1);
  });

  it('does not retry or count a non-flood failure', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const service = new TelegramUserService(createMockGramClient(), metrics);

    const op = jest.fn(async () => {
      throw new TelegramClientError('boom', { operation: 'getMe' });
    });
    await expect(service.withRetry(op, { sleep: noWait })).rejects.toThrow(
      'boom',
    );

    expect(op).toHaveBeenCalledTimes(1);
    expect(metrics.snapshot().floodWaits).toBe(0);
  });

  it('still invokes a caller-supplied onFloodWait hook', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const service = new TelegramUserService(createMockGramClient(), metrics);

    const seen: number[] = [];
    let calls = 0;
    await service.withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw floodError(4);
        return 'done';
      },
      {
        sleep: noWait,
        onFloodWait: (info) => seen.push(info.retryAfterSeconds),
      },
    );

    expect(seen).toEqual([4]);
    expect(metrics.snapshot().floodWaits).toBe(1);
  });
});
