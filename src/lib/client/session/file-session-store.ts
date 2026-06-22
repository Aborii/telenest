/**
 * @file src/lib/client/session/file-session-store.ts
 *
 * PURPOSE
 * -------
 * Filesystem-backed {@link SessionStore}. Persists the MTProto string session
 * to a single file so the account stays logged in across restarts.
 *
 * SECURITY
 * --------
 * The file contains live auth keys. It is written with `0o600` permissions
 * (owner read/write only) on POSIX systems. Keep it out of version control and
 * off shared volumes.
 *
 * USAGE
 * -----
 * ```ts
 * const store = new FileSessionStore('./.telegram.session');
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - FileSessionStore: Durable, file-backed session store.
 */

import { promises as fs } from 'node:fs';

import { TelegramSessionError } from '../../common';
import type { SessionStore } from './session-store.interface';

/**
 * Reads/writes the session string to a single UTF-8 file.
 */
export class FileSessionStore implements SessionStore {
  /**
   * @param filePath - Absolute or relative path to the session file.
   */
  public constructor(private readonly filePath: string) {}

  /**
   * Loads the session from disk.
   *
   * @returns The trimmed session string, or `undefined` if the file is missing
   *   or empty.
   * @throws {TelegramSessionError} On a non-ENOENT filesystem error.
   */
  public async load(): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch (error) {
      // ── A missing file simply means "no session yet"; anything else is a
      //    real I/O problem worth surfacing. ─────────────────────────────────
      if (this.isNotFound(error)) return undefined;
      throw new TelegramSessionError(
        `Failed to read session file at "${this.filePath}".`,
        error,
      );
    }
  }

  /**
   * Persists the session to disk atomically with owner-only permissions.
   *
   * The session is written to a sibling temp file (created `0o600`), its mode
   * re-asserted (the `mode` write option only applies when *creating* a file,
   * so it would not retighten a pre-existing target), then atomically renamed
   * over the destination — readers never observe a partially-written secret.
   *
   * @param session - The session string to write.
   * @returns Resolves once written.
   * @throws {TelegramSessionError} On a filesystem error.
   */
  public async save(session: string): Promise<void> {
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tempPath, session, { encoding: 'utf8', mode: 0o600 });
      // ── chmod is a no-op on Windows; restrict to POSIX where it matters. ──
      if (process.platform !== 'win32') await fs.chmod(tempPath, 0o600);
      await fs.rename(tempPath, this.filePath);
    } catch (error) {
      // ── Best-effort cleanup of the temp file; ignore its own failure. ─────
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw new TelegramSessionError(
        `Failed to write session file at "${this.filePath}".`,
        error,
      );
    }
  }

  /**
   * Deletes the session file if it exists.
   *
   * @returns Resolves once cleared.
   * @throws {TelegramSessionError} On a non-ENOENT filesystem error.
   */
  public async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if (this.isNotFound(error)) return;
      throw new TelegramSessionError(
        `Failed to delete session file at "${this.filePath}".`,
        error,
      );
    }
  }

  /**
   * Narrows an unknown filesystem error to a "file not found" (ENOENT) check.
   *
   * @param error - The caught value.
   * @returns `true` when the error is an ENOENT error.
   * @throws Never.
   */
  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    );
  }
}
