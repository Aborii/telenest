/**
 * @file src/lib/bot/updates/guards/rate-limit.guard.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link RateLimitGuard}: the token bucket throttles per key,
 * refills over (injected) time including fractionally, keeps keys independent,
 * applies the no-key behaviour and a custom key, and validates its options.
 */

import type { ExecutionContext, Type } from '@nestjs/common';
import type { Context } from 'telegraf';

import { TelegramConfigError } from '../../../common';
import { TelegramExecutionContext } from '../execution/telegram-execution-context';
import { RateLimitGuard, type RateLimitOptions } from './rate-limit.guard';

/** Builds an execution context whose update carries the given (optional) chat. */
function contextFor(chat?: { id: number }): ExecutionContext {
  const ctx = { chat } as unknown as Context;
  return new TelegramExecutionContext(ctx, class {} as Type, () => undefined);
}

describe('RateLimitGuard', () => {
  it('allows up to capacity, then throttles within the same interval', () => {
    const now = 1000;
    const guard = new RateLimitGuard({ capacity: 2, now: () => now });
    const ctx = contextFor({ id: 1 });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(false);

    // ── Time has not advanced, so it stays throttled. ─────────────────────────
    expect(guard.canActivate(ctx)).toBe(false);
    void now;
  });

  it('refills as time passes', () => {
    let now = 0;
    const guard = new RateLimitGuard({
      capacity: 2,
      refillPerInterval: 2,
      intervalMs: 1000,
      now: () => now,
    });
    const ctx = contextFor({ id: 1 });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(false);

    now = 1000; // one full interval → +2 tokens (capped at capacity)
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('accrues tokens fractionally between intervals', () => {
    let now = 0;
    const guard = new RateLimitGuard({
      capacity: 1,
      refillPerInterval: 1,
      intervalMs: 1000,
      now: () => now,
    });
    const ctx = contextFor({ id: 7 });

    expect(guard.canActivate(ctx)).toBe(true); // 1 → 0

    now = 500; // +0.5 token → still below 1
    expect(guard.canActivate(ctx)).toBe(false);

    now = 1000; // another +0.5 → back to 1
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('keeps buckets independent per key', () => {
    const now = 0;
    const guard = new RateLimitGuard({ capacity: 1, now: () => now });
    const a = contextFor({ id: 1 });
    const b = contextFor({ id: 2 });

    expect(guard.canActivate(a)).toBe(true);
    expect(guard.canActivate(a)).toBe(false);
    // ── Different chat, untouched bucket. ─────────────────────────────────────
    expect(guard.canActivate(b)).toBe(true);
    void now;
  });

  it('allows un-keyable updates by default, denies them when configured off', () => {
    const allowing = new RateLimitGuard({ capacity: 1 });
    expect(allowing.canActivate(contextFor(undefined))).toBe(true);

    const denying = new RateLimitGuard({ capacity: 1, allowWhenNoKey: false });
    expect(denying.canActivate(contextFor(undefined))).toBe(false);
  });

  it('supports a custom key derivation', () => {
    const now = 0;
    const guard = new RateLimitGuard({
      capacity: 1,
      key: (ctx) => ctx.from?.id,
      now: () => now,
    });
    const ctx = { from: { id: 42 } } as unknown as Context;
    const context = new TelegramExecutionContext(
      ctx,
      class {} as Type,
      () => undefined,
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(false);
    void now;
  });

  describe('option validation', () => {
    const cases: ReadonlyArray<[string, RateLimitOptions]> = [
      ['capacity below 1', { capacity: 0 }],
      ['non-finite capacity', { capacity: Number.POSITIVE_INFINITY }],
      ['refillPerInterval of 0', { capacity: 1, refillPerInterval: 0 }],
      ['negative intervalMs', { capacity: 1, intervalMs: -5 }],
    ];

    it.each(cases)('throws TelegramConfigError for %s', (_label, options) => {
      expect(() => new RateLimitGuard(options)).toThrow(TelegramConfigError);
    });
  });
});
