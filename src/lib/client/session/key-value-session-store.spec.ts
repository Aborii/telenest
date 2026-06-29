/**
 * @file src/lib/client/session/key-value-session-store.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the generic async key/value session store. Uses an in-memory
 * fake satisfying {@link AsyncKeyValueStore}; no network or real backend.
 */

import { TelegramSessionError } from '../../common';
import {
  DEFAULT_KEY_VALUE_SESSION_KEY,
  KeyValueSessionStore,
  type AsyncKeyValueStore,
} from './key-value-session-store';

/** `Map`-backed fake implementing the minimal async KV contract. */
class FakeKv implements AsyncKeyValueStore {
  public readonly map = new Map<string, string>();

  public constructor(private readonly throwOnAccess = false) {}

  public async get(key: string): Promise<string | undefined> {
    if (this.throwOnAccess) throw new Error('boom');
    return this.map.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    if (this.throwOnAccess) throw new Error('boom');
    this.map.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    if (this.throwOnAccess) throw new Error('boom');
    this.map.delete(key);
  }
}

describe('KeyValueSessionStore', () => {
  it('returns undefined when the key is absent', async () => {
    const store = new KeyValueSessionStore(new FakeKv(), 'tg:session');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('round-trips save → load', async () => {
    const kv = new FakeKv();
    const store = new KeyValueSessionStore(kv, 'tg:session');
    await store.save('session-string');
    expect(kv.map.get('tg:session')).toBe('session-string');
    await expect(store.load()).resolves.toBe('session-string');
  });

  it('treats an empty stored value as no session', async () => {
    const kv = new FakeKv();
    kv.map.set('tg:session', '');
    const store = new KeyValueSessionStore(kv, 'tg:session');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('clears the stored key', async () => {
    const kv = new FakeKv();
    const store = new KeyValueSessionStore(kv, 'tg:session');
    await store.save('x');
    await store.clear();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('defaults the key when none is supplied', async () => {
    const kv = new FakeKv();
    const store = new KeyValueSessionStore(kv);
    await store.save('x');
    expect(kv.map.has(DEFAULT_KEY_VALUE_SESSION_KEY)).toBe(true);
  });

  describe('error wrapping', () => {
    it('wraps load failures in TelegramSessionError', async () => {
      const store = new KeyValueSessionStore(new FakeKv(true));
      await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('wraps save failures in TelegramSessionError', async () => {
      const store = new KeyValueSessionStore(new FakeKv(true));
      await expect(store.save('x')).rejects.toBeInstanceOf(
        TelegramSessionError,
      );
    });

    it('wraps clear failures in TelegramSessionError', async () => {
      const store = new KeyValueSessionStore(new FakeKv(true));
      await expect(store.clear()).rejects.toBeInstanceOf(TelegramSessionError);
    });
  });
});
