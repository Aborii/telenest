/**
 * @file src/lib/client/session/redis-session-store.ts
 *
 * PURPOSE
 * -------
 * Redis-backed {@link SessionStore}. Persists the MTProto string session under
 * a single Redis key, which fits clustered / serverless deployments where a
 * plaintext file on local disk is impractical or undesirable.
 *
 * SECURITY
 * --------
 * The stored value is a live account credential. Redis offers no at-rest
 * encryption by default — wrap this store in an {@link EncryptedSessionStore}
 * when the Redis instance (or its persistence/RDB dumps) might be exposed.
 *
 * USAGE
 * -----
 * ```ts
 * import { createClient } from 'redis';
 * const redis = createClient();
 * await redis.connect();
 * const store = new RedisSessionStore(redis, 'tg:session');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - MinimalRedisClient: Structural subset of a redis client this store needs.
 * - RedisSessionStore: Redis-backed session store.
 */

import { TelegramSessionError } from '../../common';
import type { Awaitable } from '../../common';
import type { SessionStore } from './session-store.interface';

/**
 * The minimal slice of a Redis client this store depends on. Declaring it
 * structurally (rather than importing the `redis` package) keeps `redis` an
 * optional dependency — any client exposing these three methods works, whether
 * `node-redis`, `ioredis`, or a test fake.
 */
export interface MinimalRedisClient {
  /**
   * Returns the string value stored at `key`, or `null`/`undefined` when the
   * key is absent.
   *
   * @param key - The Redis key to read.
   */
  get(key: string): Awaitable<string | null | undefined>;

  /**
   * Stores `value` at `key`, overwriting any previous value.
   *
   * @param key - The Redis key to write.
   * @param value - The value to persist.
   */
  set(key: string, value: string): Awaitable<unknown>;

  /**
   * Deletes `key` if it exists.
   *
   * @param key - The Redis key to remove.
   */
  del(key: string): Awaitable<unknown>;
}

/** Default Redis key used when the caller does not supply one. */
export const DEFAULT_REDIS_SESSION_KEY = 'nestjs-telegram:session';

/**
 * Reads/writes the session string to a Redis key via an injected client.
 */
export class RedisSessionStore implements SessionStore {
  /**
   * @param client - A connected Redis client exposing {@link MinimalRedisClient}.
   * @param key - The Redis key to store the session under. Defaults to
   *   {@link DEFAULT_REDIS_SESSION_KEY}.
   */
  public constructor(
    private readonly client: MinimalRedisClient,
    private readonly key: string = DEFAULT_REDIS_SESSION_KEY,
  ) {}

  /**
   * Loads the session from Redis.
   *
   * @returns The stored session string, or `undefined` if the key is absent or
   *   holds an empty value.
   * @throws {TelegramSessionError} If the Redis read fails.
   */
  public async load(): Promise<string | undefined> {
    try {
      const value = await this.client.get(this.key);
      // ── A missing key (null/undefined) or empty string means "no session". ─
      return value !== null && value !== undefined && value.length > 0
        ? value
        : undefined;
    } catch (error) {
      throw new TelegramSessionError(
        `Failed to read session from Redis key "${this.key}".`,
        error,
      );
    }
  }

  /**
   * Persists the session to Redis, overwriting any previous value.
   *
   * @param session - The session string to store.
   * @returns Resolves once written.
   * @throws {TelegramSessionError} If the Redis write fails.
   */
  public async save(session: string): Promise<void> {
    try {
      await this.client.set(this.key, session);
    } catch (error) {
      throw new TelegramSessionError(
        `Failed to write session to Redis key "${this.key}".`,
        error,
      );
    }
  }

  /**
   * Deletes the session key from Redis.
   *
   * @returns Resolves once cleared.
   * @throws {TelegramSessionError} If the Redis delete fails.
   */
  public async clear(): Promise<void> {
    try {
      await this.client.del(this.key);
    } catch (error) {
      throw new TelegramSessionError(
        `Failed to delete session from Redis key "${this.key}".`,
        error,
      );
    }
  }
}
