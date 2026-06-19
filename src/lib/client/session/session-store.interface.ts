/**
 * @file src/lib/client/session/session-store.interface.ts
 *
 * PURPOSE
 * -------
 * Pluggable persistence contract for MTProto string sessions. A session string
 * encodes the auth keys that let the client reconnect without re-running the
 * phone/code/2FA flow, so it MUST be stored as securely as a password.
 *
 * USAGE
 * -----
 * ```ts
 * class RedisSessionStore implements SessionStore {
 *   async load() { return (await redis.get('tg:session')) ?? undefined; }
 *   async save(s: string) { await redis.set('tg:session', s); }
 *   async clear() { await redis.del('tg:session'); }
 * }
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - SessionStore: The interface implemented by all session backends.
 */

import type { Awaitable } from '../../common';

/**
 * Persistence backend for a single MTProto string session.
 *
 * Implementations may be sync or async; all methods are awaited by the library.
 */
export interface SessionStore {
  /**
   * Loads the previously persisted session string, if any.
   *
   * @returns The session string, or `undefined` when none is stored.
   * @throws {import('../../common').TelegramSessionError} On a read failure.
   */
  load(): Awaitable<string | undefined>;

  /**
   * Persists the session string, overwriting any previous value.
   *
   * @param session - The string session to persist.
   * @returns Resolves once the value is durably stored.
   * @throws {import('../../common').TelegramSessionError} On a write failure.
   */
  save(session: string): Awaitable<void>;

  /**
   * Removes any persisted session (used on logout).
   *
   * @returns Resolves once cleared.
   * @throws {import('../../common').TelegramSessionError} On a delete failure.
   */
  clear(): Awaitable<void>;
}
