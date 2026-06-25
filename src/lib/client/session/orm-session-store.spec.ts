/**
 * @file src/lib/client/session/orm-session-store.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the ORM/SQL-backed session store. Uses an in-memory fake that
 * satisfies {@link OrmSessionRepository} (modelling a single keyed table); no
 * database or network is touched. Also covers the repository→KV adapter and
 * composition with {@link EncryptedSessionStore}.
 */

import { TelegramSessionError } from '../../common';
import { DEFAULT_KEY_VALUE_SESSION_KEY } from './key-value-session-store';
import { EncryptedSessionStore } from './encrypted-session-store';
import {
  OrmSessionStore,
  ormRepositoryToKeyValueStore,
  type OrmSessionRepository,
  type OrmSessionRow,
} from './orm-session-store';

/**
 * In-memory stand-in for an ORM repository, backed by a `Map` of rows.
 * Optionally throws from every method to exercise the error-wrapping paths.
 */
class FakeOrmRepository implements OrmSessionRepository {
  public readonly rows = new Map<string, OrmSessionRow>();

  public constructor(private readonly throwOnAccess = false) {}

  public findByKey(key: string): OrmSessionRow | null {
    if (this.throwOnAccess) throw new Error('boom');
    return this.rows.get(key) ?? null;
  }

  public upsert(row: OrmSessionRow): void {
    if (this.throwOnAccess) throw new Error('boom');
    // ── Upsert: a second save under the same key overwrites, never collides. ──
    this.rows.set(row.key, { ...row });
  }

  public deleteByKey(key: string): void {
    if (this.throwOnAccess) throw new Error('boom');
    this.rows.delete(key);
  }
}

describe('OrmSessionStore', () => {
  it('returns undefined when no row exists', async () => {
    const store = new OrmSessionStore(new FakeOrmRepository(), 'tg:session');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('round-trips save → load through a row', async () => {
    const repo = new FakeOrmRepository();
    const store = new OrmSessionStore(repo, 'tg:session');
    await store.save('session-string');
    expect(repo.rows.get('tg:session')).toEqual({
      key: 'tg:session',
      value: 'session-string',
    });
    await expect(store.load()).resolves.toBe('session-string');
  });

  it('overwrites an existing row on re-save (idempotent upsert)', async () => {
    const repo = new FakeOrmRepository();
    const store = new OrmSessionStore(repo, 'tg:session');
    await store.save('first');
    await store.save('second');
    expect(repo.rows.size).toBe(1);
    await expect(store.load()).resolves.toBe('second');
  });

  it('treats an empty stored value as no session', async () => {
    const repo = new FakeOrmRepository();
    repo.rows.set('tg:session', { key: 'tg:session', value: '' });
    const store = new OrmSessionStore(repo, 'tg:session');
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('clears the stored row', async () => {
    const repo = new FakeOrmRepository();
    const store = new OrmSessionStore(repo, 'tg:session');
    await store.save('x');
    await store.clear();
    expect(repo.rows.size).toBe(0);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('defaults the key when none is supplied', async () => {
    const repo = new FakeOrmRepository();
    const store = new OrmSessionStore(repo);
    await store.save('x');
    expect(repo.rows.has(DEFAULT_KEY_VALUE_SESSION_KEY)).toBe(true);
  });

  it('isolates accounts that share a repository via distinct keys', async () => {
    const repo = new FakeOrmRepository();
    const personal = new OrmSessionStore(repo, 'nestjs-telegram:session:personal');
    const ops = new OrmSessionStore(repo, 'nestjs-telegram:session:ops');

    await personal.save('personal-session');
    await ops.save('ops-session');

    await expect(personal.load()).resolves.toBe('personal-session');
    await expect(ops.load()).resolves.toBe('ops-session');
    expect(repo.rows.size).toBe(2);
  });

  it('composes with EncryptedSessionStore for at-rest encryption', async () => {
    const repo = new FakeOrmRepository();
    const secret = 'a-32-byte-or-longer-secret-value!!';
    const store = new EncryptedSessionStore(
      new OrmSessionStore(repo, 'tg:session'),
      secret,
    );

    await store.save('plaintext-session');
    // The persisted row holds ciphertext, not the raw session.
    expect(repo.rows.get('tg:session')?.value).not.toContain(
      'plaintext-session',
    );
    await expect(store.load()).resolves.toBe('plaintext-session');
  });

  describe('error wrapping', () => {
    it('wraps load failures in TelegramSessionError', async () => {
      const store = new OrmSessionStore(new FakeOrmRepository(true));
      await expect(store.load()).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('wraps save failures in TelegramSessionError', async () => {
      const store = new OrmSessionStore(new FakeOrmRepository(true));
      await expect(store.save('x')).rejects.toBeInstanceOf(TelegramSessionError);
    });

    it('wraps clear failures in TelegramSessionError', async () => {
      const store = new OrmSessionStore(new FakeOrmRepository(true));
      await expect(store.clear()).rejects.toBeInstanceOf(TelegramSessionError);
    });
  });

  describe('ormRepositoryToKeyValueStore', () => {
    it('reads the value off a present row and undefined when absent', async () => {
      const repo = new FakeOrmRepository();
      const kv = ormRepositoryToKeyValueStore(repo);
      await expect(kv.get('k')).resolves.toBeUndefined();
      await kv.set('k', 'v');
      await expect(kv.get('k')).resolves.toBe('v');
      await kv.delete('k');
      await expect(kv.get('k')).resolves.toBeUndefined();
    });
  });
});
