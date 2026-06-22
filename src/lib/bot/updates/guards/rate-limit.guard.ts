/**
 * @file src/lib/bot/updates/guards/rate-limit.guard.ts
 *
 * PURPOSE
 * -------
 * A built-in guard that throttles updates per key (per chat by default) using a
 * token-bucket algorithm: each key gets a bucket of `capacity` tokens that refill
 * continuously at `refillPerInterval` tokens every `intervalMs`. An update is
 * allowed when a token is available (consuming one) and blocked otherwise — giving
 * smooth rate limiting with a configurable burst.
 *
 * USAGE
 * -----
 * ```ts
 * // Up to 5 quickly, then ~1 per second sustained, per chat:
 * @UseTelegramGuards(new RateLimitGuard({ capacity: 5, refillPerInterval: 1 }))
 * @On('text') onText(@Ctx() ctx: Context) { ... }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - RateLimitOptions: configuration for the guard.
 * - RateLimitGuard: the guard implementation.
 */

import { Injectable, type ExecutionContext } from '@nestjs/common';
import type { Context } from 'telegraf';

import { TelegramConfigError } from '../../../common';
import type { TelegramGuard } from '../execution/enhancer.types';
import { TelegramExecutionContext } from '../execution/telegram-execution-context';

/** Configuration for {@link RateLimitGuard}. */
export interface RateLimitOptions {
  /** Maximum tokens a bucket holds — the burst size. Must be a finite number ≥ 1. */
  readonly capacity: number;
  /**
   * Tokens added to a bucket every {@link RateLimitOptions.intervalMs}. Defaults
   * to {@link RateLimitOptions.capacity} (i.e. a full refill each interval). Must
   * be > 0.
   */
  readonly refillPerInterval?: number;
  /** Refill interval length in milliseconds. Defaults to `1000`. Must be > 0. */
  readonly intervalMs?: number;
  /**
   * Derives the bucket key from the update. Defaults to the chat ID
   * (`ctx.chat?.id`). Return `undefined` to opt an update out of rate limiting
   * (see {@link RateLimitOptions.allowWhenNoKey}).
   */
  readonly key?: (ctx: Context) => string | number | undefined;
  /**
   * Whether to allow updates for which {@link RateLimitOptions.key} returns
   * `undefined` (no bucket can be formed). Defaults to `true` — an update that
   * cannot be keyed is not throttled.
   */
  readonly allowWhenNoKey?: boolean;
  /**
   * Time source in milliseconds, injected for deterministic tests. Defaults to
   * `Date.now`.
   */
  readonly now?: () => number;
}

/** One key's token bucket. */
interface TokenBucket {
  /** Tokens currently available (fractional during refill). */
  tokens: number;
  /** Timestamp (ms) the bucket was last refilled. */
  updatedAt: number;
}

/**
 * Per-key token-bucket rate limiter. Holds one bucket per key in memory, so a
 * single shared instance is what enforces the limit across updates — configure it
 * as an instance, e.g. `new RateLimitGuard({ capacity: 5 })`.
 */
@Injectable()
export class RateLimitGuard implements TelegramGuard {
  /** Live buckets keyed by the stringified bucket key. */
  private readonly _buckets = new Map<string, TokenBucket>();

  /** Maximum (burst) tokens per bucket. */
  private readonly _capacity: number;

  /** Tokens added per interval. */
  private readonly _refillPerInterval: number;

  /** Interval length in milliseconds. */
  private readonly _intervalMs: number;

  /** Derives the bucket key from an update context. */
  private readonly _key: (ctx: Context) => string | number | undefined;

  /** Whether unkeyable updates are allowed. */
  private readonly _allowWhenNoKey: boolean;

  /** Injectable clock (defaults to `Date.now`). */
  private readonly _now: () => number;

  /**
   * @param options - Bucket sizing, key derivation, and (test) clock.
   * @throws {TelegramConfigError} If `capacity`, `refillPerInterval`, or
   *   `intervalMs` are out of range.
   */
  public constructor(options: RateLimitOptions) {
    if (!Number.isFinite(options.capacity) || options.capacity < 1)
      throw new TelegramConfigError(
        'RateLimitGuard "capacity" must be a finite number >= 1.',
      );

    const refillPerInterval = options.refillPerInterval ?? options.capacity;
    if (!Number.isFinite(refillPerInterval) || refillPerInterval <= 0)
      throw new TelegramConfigError(
        'RateLimitGuard "refillPerInterval" must be a finite number > 0.',
      );

    const intervalMs = options.intervalMs ?? 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
      throw new TelegramConfigError(
        'RateLimitGuard "intervalMs" must be a finite number > 0.',
      );

    this._capacity = options.capacity;
    this._refillPerInterval = refillPerInterval;
    this._intervalMs = intervalMs;
    this._key = options.key ?? ((ctx) => ctx.chat?.id);
    this._allowWhenNoKey = options.allowWhenNoKey ?? true;
    this._now = options.now ?? Date.now;
  }

  /**
   * Allows the update when its bucket has at least one token, consuming one.
   *
   * @param context - The execution context for the current update.
   * @returns `true` when within the rate limit, `false` when throttled.
   * @throws Never.
   */
  public canActivate(context: ExecutionContext): boolean {
    const ctx = TelegramExecutionContext.create(context).getContext();
    const rawKey = this._key(ctx);
    if (rawKey === undefined) return this._allowWhenNoKey;

    const bucket = this._refill(String(rawKey), this._now());
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /**
   * Returns the (created-or-refilled) bucket for a key. New buckets start full;
   * existing buckets accrue `elapsed / intervalMs * refillPerInterval` tokens,
   * capped at capacity.
   *
   * @param key - The stringified bucket key.
   * @param now - The current time in milliseconds.
   * @returns The up-to-date bucket for `key`.
   * @throws Never.
   */
  private _refill(key: string, now: number): TokenBucket {
    const existing = this._buckets.get(key);
    if (!existing) {
      const fresh: TokenBucket = { tokens: this._capacity, updatedAt: now };
      this._buckets.set(key, fresh);
      return fresh;
    }

    const elapsed = Math.max(0, now - existing.updatedAt);
    if (elapsed > 0) {
      const refill = (elapsed / this._intervalMs) * this._refillPerInterval;
      existing.tokens = Math.min(this._capacity, existing.tokens + refill);
      existing.updatedAt = now;
    }
    return existing;
  }
}
