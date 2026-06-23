/**
 * @file src/lib/common/observability/telegram-metrics.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the shared metrics primitives: the counter vocabulary, the
 * in-memory recorder's increment/snapshot/reset semantics, and the no-op sink.
 * Pure in-process logic — no network.
 */

import {
  InMemoryTelegramMetrics,
  NOOP_TELEGRAM_METRICS,
  TELEGRAM_COUNTER_VALUES,
  TELEGRAM_COUNTERS,
} from './telegram-metrics';

describe('TELEGRAM_COUNTERS', () => {
  it('derives the values array from the record', () => {
    expect(new Set(TELEGRAM_COUNTER_VALUES)).toEqual(
      new Set([
        TELEGRAM_COUNTERS.MESSAGES_SENT,
        TELEGRAM_COUNTERS.MESSAGES_RECEIVED,
        TELEGRAM_COUNTERS.API_ERRORS,
        TELEGRAM_COUNTERS.FLOOD_WAITS,
      ]),
    );
    expect(TELEGRAM_COUNTER_VALUES).toHaveLength(4);
  });
});

describe('InMemoryTelegramMetrics', () => {
  it('starts with every counter at zero', () => {
    const metrics = new InMemoryTelegramMetrics();
    expect(metrics.snapshot()).toEqual({
      messagesSent: 0,
      messagesReceived: 0,
      apiErrors: 0,
      floodWaits: 0,
    });
  });

  it('increments by 1 by default and accumulates', () => {
    const metrics = new InMemoryTelegramMetrics();
    metrics.increment(TELEGRAM_COUNTERS.MESSAGES_SENT);
    metrics.increment(TELEGRAM_COUNTERS.MESSAGES_SENT);
    expect(metrics.snapshot().messagesSent).toBe(2);
  });

  it('honours an explicit positive delta', () => {
    const metrics = new InMemoryTelegramMetrics();
    metrics.increment(TELEGRAM_COUNTERS.API_ERRORS, 5);
    expect(metrics.snapshot().apiErrors).toBe(5);
  });

  it('ignores non-positive or non-finite deltas', () => {
    const metrics = new InMemoryTelegramMetrics();
    metrics.increment(TELEGRAM_COUNTERS.FLOOD_WAITS, 0);
    metrics.increment(TELEGRAM_COUNTERS.FLOOD_WAITS, -3);
    metrics.increment(TELEGRAM_COUNTERS.FLOOD_WAITS, Number.NaN);
    metrics.increment(TELEGRAM_COUNTERS.FLOOD_WAITS, Number.POSITIVE_INFINITY);
    expect(metrics.snapshot().floodWaits).toBe(0);
  });

  it('returns a defensive copy from snapshot', () => {
    const metrics = new InMemoryTelegramMetrics();
    const snap = metrics.snapshot();
    (snap as { messagesSent: number }).messagesSent = 99;
    expect(metrics.snapshot().messagesSent).toBe(0);
  });

  it('resets every counter back to zero', () => {
    const metrics = new InMemoryTelegramMetrics();
    metrics.increment(TELEGRAM_COUNTERS.MESSAGES_SENT, 3);
    metrics.increment(TELEGRAM_COUNTERS.MESSAGES_RECEIVED, 4);
    metrics.reset();
    expect(metrics.snapshot()).toEqual({
      messagesSent: 0,
      messagesReceived: 0,
      apiErrors: 0,
      floodWaits: 0,
    });
  });
});

describe('NOOP_TELEGRAM_METRICS', () => {
  it('accepts increments without throwing or recording', () => {
    expect(() =>
      NOOP_TELEGRAM_METRICS.increment(TELEGRAM_COUNTERS.MESSAGES_SENT, 10),
    ).not.toThrow();
  });
});
