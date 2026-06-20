/**
 * @file src/lib/client/session/file-session-store.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the filesystem-backed session store, using a real temp file
 * (no mocking of `fs`) to exercise the actual read/write/delete paths.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelegramSessionError } from '../../common';
import { FileSessionStore } from './file-session-store';

describe('FileSessionStore', () => {
  let filePath: string;

  beforeEach(() => {
    // ── Unique-enough path per test; jest runs files in isolated workers. ────
    filePath = join(
      tmpdir(),
      `nestjs-telegram-test-${process.pid}-${expect.getState().currentTestName ?? 'x'}`.replace(
        /[^a-zA-Z0-9-_]/g,
        '_',
      ),
    );
  });

  afterEach(async () => {
    await fs.rm(filePath, { force: true });
  });

  it('returns undefined when the file does not exist', async () => {
    const store = new FileSessionStore(filePath);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('round-trips save → load (trimming whitespace)', async () => {
    const store = new FileSessionStore(filePath);
    await store.save('session-string');
    await expect(store.load()).resolves.toBe('session-string');
  });

  it('treats an empty/whitespace file as no session', async () => {
    const store = new FileSessionStore(filePath);
    await store.save('   ');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('clear removes the file and is a no-op when absent', async () => {
    const store = new FileSessionStore(filePath);
    await store.save('x');
    await store.clear();
    await expect(store.load()).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('wraps read failures (e.g. a directory path) in TelegramSessionError', async () => {
    // ── tmpdir() is a directory; reading it as a file yields EISDIR, not
    //    ENOENT, so it must surface as a typed session error. ───────────────
    const store = new FileSessionStore(tmpdir());
    await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
  });

  describe('deterministic error wrapping (mocked fs)', () => {
    afterEach(() => jest.restoreAllMocks());

    /** A non-ENOENT filesystem error. */
    const eacces = (): NodeJS.ErrnoException =>
      Object.assign(new Error('permission denied'), { code: 'EACCES' });

    it('wraps non-ENOENT load failures', async () => {
      jest.spyOn(fs, 'readFile').mockRejectedValueOnce(eacces());
      await expect(new FileSessionStore(filePath).load()).rejects.toBeInstanceOf(
        TelegramSessionError,
      );
    });

    it('wraps save failures', async () => {
      jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(eacces());
      await expect(
        new FileSessionStore(filePath).save('s'),
      ).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('wraps non-ENOENT clear failures', async () => {
      jest.spyOn(fs, 'unlink').mockRejectedValueOnce(eacces());
      await expect(new FileSessionStore(filePath).clear()).rejects.toBeInstanceOf(
        TelegramSessionError,
      );
    });

    it('re-asserts 0o600 via chmod on POSIX platforms', async () => {
      // ── Force the POSIX branch (this runner may be Windows). chmod is spied
      //    so the test does not depend on the real filesystem's mode bits. ────
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const chmodSpy = jest
        .spyOn(fs, 'chmod')
        .mockResolvedValue(undefined);
      try {
        await new FileSessionStore(filePath).save('secret');
        expect(chmodSpy).toHaveBeenCalledWith(expect.any(String), 0o600);
      } finally {
        Object.defineProperty(process, 'platform', { value: original });
      }
    });
  });
});
