/**
 * @file src/lib/client/session/memory-session-store.ts
 *
 * PURPOSE
 * -------
 * In-memory {@link SessionStore} implementation. Useful for tests and for
 * short-lived processes, but NOT durable: the session is lost on restart, which
 * forces a fresh phone/code login next time.
 *
 * USAGE
 * -----
 * ```ts
 * const store = new InMemorySessionStore(process.env.TG_SESSION);
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - InMemorySessionStore: Volatile, process-local session store.
 */

import type { SessionStore } from './session-store.interface';

/**
 * Stores the session string in a private field. Survives only for the lifetime
 * of the process.
 */
export class InMemorySessionStore implements SessionStore {
  /** The currently held session string, or `undefined` when none. */
  private _session: string | undefined;

  /**
   * @param initial - An optional seed session (e.g. from an env var).
   */
  public constructor(initial?: string) {
    this._session = initial && initial.length > 0 ? initial : undefined;
  }

  /**
   * @returns The in-memory session string, or `undefined`.
   * @throws Never.
   */
  public load(): string | undefined {
    return this._session;
  }

  /**
   * @param session - The session string to hold in memory.
   * @returns Nothing.
   * @throws Never.
   */
  public save(session: string): void {
    this._session = session;
  }

  /**
   * Clears the in-memory session.
   *
   * @returns Nothing.
   * @throws Never.
   */
  public clear(): void {
    this._session = undefined;
  }
}
