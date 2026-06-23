/**
 * @file src/lib/client/session/redis-session-store.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the Redis-backed session store. Uses an in-memory fake that
 * satisfies {@link MinimalRedisClient}; no network or real Redis is touched.
 */

import { TelegramSessionError } from '../../common';
import {
  DEFAULT_REDIS_SESSION_KEY,
  RedisSessionStore,
  type MinimalRedisClient,
} from './redis-session-store';

/**
 * In-memory stand-in for a Redis client, backed by a `Map`. Optionally throws
 * from every method to exercise the error-wrapping paths.
 */
class FakeRedis implements MinimalRedisClient {
  public readonly map = new Map<string, string>();

  public constructor(private readonly throwOnAccess = false) {}

  public get(key: string): string | null {
    if (this.throwOnAccess) throw new Error('boom');
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  public set(key: string, value: string): void {
    if (this.throwOnAccess) throw new Error('boom');
    this.map.set(key, value);
  }

  public del(key: string): void {
    if (this.throwOnAccess) throw new Error('boom');
    this.map.delete(key);
  }
}

describe('RedisSessionStore', () => {
  it('returns undefined when the key is absent', async () => {
    const store = new RedisSessionStore(new FakeRedis(), 'tg:session');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('round-trips save → load', async () => {
    const redis = new FakeRedis();
    const store = new RedisSessionStore(redis, 'tg:session');
    await store.save('session-string');
    expect(redis.map.get('tg:session')).toBe('session-string');
    await expect(store.load()).resolves.toBe('session-string');
  });

  it('treats an empty stored value as no session', async () => {
    const redis = new FakeRedis();
    redis.map.set('tg:session', '');
    const store = new RedisSessionStore(redis, 'tg:session');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('clears the stored key', async () => {
    const redis = new FakeRedis();
    const store = new RedisSessionStore(redis, 'tg:session');
    await store.save('x');
    await store.clear();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('defaults the key when none is supplied', async () => {
    const redis = new FakeRedis();
    const store = new RedisSessionStore(redis);
    await store.save('x');
    expect(redis.map.has(DEFAULT_REDIS_SESSION_KEY)).toBe(true);
  });

  describe('error wrapping', () => {
    it('wraps load failures in TelegramSessionError', async () => {
      const store = new RedisSessionStore(new FakeRedis(true));
      await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('wraps save failures in TelegramSessionError', async () => {
      const store = new RedisSessionStore(new FakeRedis(true));
      await expect(store.save('x')).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('wraps clear failures in TelegramSessionError', async () => {
      const store = new RedisSessionStore(new FakeRedis(true));
      await expect(store.clear()).rejects.toBeInstanceOf(TelegramSessionError);
    });
  });
});
