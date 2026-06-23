/**
 * @file src/lib/client/session/encrypted-session-store.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the AES-256-GCM session encryption decorator. Verifies
 * round-trip, ciphertext randomization, and fail-closed behavior on tamper and
 * wrong-key. Uses {@link InMemorySessionStore} as the inner store — no network.
 */

import { TelegramSessionError } from '../../common';
import { EncryptedSessionStore } from './encrypted-session-store';
import { InMemorySessionStore } from './memory-session-store';
import type { SessionStore } from './session-store.interface';

/** A throwaway high-entropy secret for tests. */
const SECRET = 'test-secret-please-ignore-0123456789';

describe('EncryptedSessionStore', () => {
  it('rejects an empty secret', () => {
    expect(() => new EncryptedSessionStore(new InMemorySessionStore(), '')).toThrow(
      TelegramSessionError,
    );
  });

  it('round-trips save → load through encryption', async () => {
    const inner = new InMemorySessionStore();
    const store = new EncryptedSessionStore(inner, SECRET);
    await store.save('my-session-string');
    await expect(store.load()).resolves.toBe('my-session-string');
  });

  it('stores ciphertext, not plaintext, in the inner store', async () => {
    const inner = new InMemorySessionStore();
    const store = new EncryptedSessionStore(inner, SECRET);
    await store.save('my-session-string');
    const stored = inner.load();
    expect(stored).toBeDefined();
    expect(stored).not.toContain('my-session-string');
    expect(stored?.startsWith('tgenc1:')).toBe(true);
  });

  it('produces a different ciphertext each save (random IV)', async () => {
    const a = new InMemorySessionStore();
    const b = new InMemorySessionStore();
    await new EncryptedSessionStore(a, SECRET).save('same');
    await new EncryptedSessionStore(b, SECRET).save('same');
    expect(a.load()).not.toBe(b.load());
    // ── Distinct ciphertexts must both still decrypt to the same plaintext. ──
    await expect(new EncryptedSessionStore(a, SECRET).load()).resolves.toBe(
      'same',
    );
    await expect(new EncryptedSessionStore(b, SECRET).load()).resolves.toBe(
      'same',
    );
  });

  it('returns undefined when the inner store is empty', async () => {
    const store = new EncryptedSessionStore(new InMemorySessionStore(), SECRET);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('accepts a Buffer secret', async () => {
    const inner = new InMemorySessionStore();
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
    const store = new EncryptedSessionStore(inner, key);
    await store.save('via-buffer');
    await expect(store.load()).resolves.toBe('via-buffer');
  });

  it('delegates clear to the inner store', async () => {
    const inner = new InMemorySessionStore('seed');
    const store = new EncryptedSessionStore(inner, SECRET);
    await store.clear();
    expect(inner.load()).toBeUndefined();
  });

  describe('fail-closed', () => {
    it('fails on a wrong key', async () => {
      const inner = new InMemorySessionStore();
      await new EncryptedSessionStore(inner, SECRET).save('secret-session');
      const wrong = new EncryptedSessionStore(inner, 'a-completely-different-key');
      await expect(wrong.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('fails on a tampered ciphertext', async () => {
      const inner = new InMemorySessionStore();
      const store = new EncryptedSessionStore(inner, SECRET);
      await store.save('secret-session');
      // ── Flip the last base64 char of the stored payload. ────────────────────
      const payload = inner.load() as string;
      const flipped =
        payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
      inner.save(flipped);
      await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('rejects a payload without the format prefix', async () => {
      const inner = new InMemorySessionStore('plain-unprefixed-value');
      const store = new EncryptedSessionStore(inner, SECRET);
      await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('rejects a truncated payload', async () => {
      const inner = new InMemorySessionStore('tgenc1:AAAA');
      const store = new EncryptedSessionStore(inner, SECRET);
      await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('propagates inner save failures', async () => {
      const failing: SessionStore = {
        load: () => undefined,
        save: () => {
          throw new TelegramSessionError('inner write failed');
        },
        clear: () => undefined,
      };
      const store = new EncryptedSessionStore(failing, SECRET);
      await expect(store.save('x')).rejects.toBeInstanceOf(TelegramSessionError);
    });
  });
});
