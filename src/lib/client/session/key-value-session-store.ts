/**
 * @file src/lib/client/session/key-value-session-store.ts
 *
 * PURPOSE
 * -------
 * Generic async key/value {@link SessionStore}. Adapts any backend that exposes
 * a `get`/`set`/`delete` trio — a database table, [Keyv](https://keyv.org), an
 * S3-like blob, an HTTP KV — into a session store, so the library needs no
 * dedicated implementation per backend.
 *
 * SECURITY
 * --------
 * The stored value is a live account credential. Most KV backends store it in
 * plaintext; wrap this store in an {@link EncryptedSessionStore} when the
 * backing store could be exposed.
 *
 * USAGE
 * -----
 * ```ts
 * import Keyv from 'keyv';
 * const store = new KeyValueSessionStore(new Keyv('postgres://…'), 'tg:session');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - AsyncKeyValueStore: Structural subset of a KV backend this store needs.
 * - KeyValueSessionStore: Session store over any async KV backend.
 */

import { TelegramSessionError } from '../../common';
import type { Awaitable } from '../../common';
import type { SessionStore } from './session-store.interface';

/**
 * The minimal slice of an async key/value backend this store depends on.
 * Declared structurally so any compatible client (Keyv, a DB DAO, a Map-backed
 * fake) satisfies it without a hard dependency. Keyv's `get`/`set`/`delete`
 * signatures match this shape directly.
 */
export interface AsyncKeyValueStore {
  /**
   * Returns the value stored at `key`, or `null`/`undefined` when absent.
   *
   * @param key - The key to read.
   */
  get(key: string): Awaitable<string | null | undefined>;

  /**
   * Stores `value` at `key`, overwriting any previous value.
   *
   * @param key - The key to write.
   * @param value - The value to persist.
   */
  set(key: string, value: string): Awaitable<unknown>;

  /**
   * Deletes `key` if present.
   *
   * @param key - The key to remove.
   */
  delete(key: string): Awaitable<unknown>;
}

/** Default key used when the caller does not supply one. */
export const DEFAULT_KEY_VALUE_SESSION_KEY = 'nestjs-telegram:session';

/**
 * Persists the session string through an injected async key/value backend.
 */
export class KeyValueSessionStore implements SessionStore {
  /**
   * @param store - The async KV backend exposing {@link AsyncKeyValueStore}.
   * @param key - The key to store the session under. Defaults to
   *   {@link DEFAULT_KEY_VALUE_SESSION_KEY}.
   */
  public constructor(
    private readonly store: AsyncKeyValueStore,
    private readonly key: string = DEFAULT_KEY_VALUE_SESSION_KEY,
  ) {}

  /**
   * Loads the session from the KV backend.
   *
   * @returns The stored session string, or `undefined` when absent or empty.
   * @throws {TelegramSessionError} If the backend read fails.
   */
  public async load(): Promise<string | undefined> {
    try {
      const value = await this.store.get(this.key);
      return value !== null && value !== undefined && value.length > 0
        ? value
        : undefined;
    } catch (error) {
      throw new TelegramSessionError(
        `Failed to read session from key/value store key "${this.key}".`,
        error,
      );
    }
  }

  /**
   * Persists the session to the KV backend, overwriting any previous value.
   *
   * @param session - The session string to store.
   * @returns Resolves once written.
   * @throws {TelegramSessionError} If the backend write fails.
   */
  public async save(session: string): Promise<void> {
    try {
      await this.store.set(this.key, session);
    } catch (error) {
      throw new TelegramSessionError(
        `Failed to write session to key/value store key "${this.key}".`,
        error,
      );
    }
  }

  /**
   * Deletes the session from the KV backend.
   *
   * @returns Resolves once cleared.
   * @throws {TelegramSessionError} If the backend delete fails.
   */
  public async clear(): Promise<void> {
    try {
      await this.store.delete(this.key);
    } catch (error) {
      throw new TelegramSessionError(
        `Failed to delete session from key/value store key "${this.key}".`,
        error,
      );
    }
  }
}
