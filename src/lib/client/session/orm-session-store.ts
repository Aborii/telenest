/**
 * @file src/lib/client/session/orm-session-store.ts
 *
 * PURPOSE
 * -------
 * ORM-backed (SQL) {@link SessionStore}, built on {@link KeyValueSessionStore}.
 * It persists the MTProto string session as a single row keyed by a string, so
 * applications that already run a SQL database (via TypeORM, Prisma, MikroORM,
 * Sequelize, …) can store sessions there without hand-writing a key/value
 * adapter. The ORM stays an **optional peer**: this file imports no ORM package
 * and depends only on a small structural repository contract that any of them
 * satisfies directly or through a few-line wrapper.
 *
 * SECURITY
 * --------
 * The stored value is a live account credential. A plain database column holds
 * it in plaintext — wrap this store in an {@link EncryptedSessionStore} when the
 * database (or its backups) could be exposed. Never log the session string.
 *
 * USAGE
 * -----
 * ```ts
 * // TypeORM: wrap a Repository<SessionEntity> (columns: `key`, `value`).
 * const repo = dataSource.getRepository(SessionEntity);
 * const store = new OrmSessionStore({
 *   findByKey: (key) => repo.findOne({ where: { key } }),
 *   upsert: (row) => repo.save(row),
 *   deleteByKey: (key) => repo.delete({ key }),
 * });
 *
 * // At-rest encryption + a per-account key for multi-account setups:
 * const secured = new EncryptedSessionStore(
 *   new OrmSessionStore(repo, 'nestjs-telegram:session:ops'),
 *   process.env.SESSION_SECRET!,
 * );
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - OrmSessionRow: A single persisted session row (`key` + `value`).
 * - OrmSessionRepository: Structural ORM-repository contract this store needs.
 * - ormRepositoryToKeyValueStore: Adapts a repository to an `AsyncKeyValueStore`.
 * - OrmSessionStore: SQL/ORM-backed session store over a repository.
 */

import type { Awaitable } from '../../common';
import {
  DEFAULT_KEY_VALUE_SESSION_KEY,
  KeyValueSessionStore,
  type AsyncKeyValueStore,
} from './key-value-session-store';

/**
 * A single persisted session row: the lookup `key` and the session `value`.
 * Mirrors a two-column table (e.g. `telegram_session(key PRIMARY KEY, value)`).
 */
export interface OrmSessionRow {
  /** The row's primary key — the session is stored/looked up under it. */
  key: string;
  /** The MTProto string session persisted for {@link OrmSessionRow.key}. */
  value: string;
}

/**
 * The minimal slice of an ORM repository/table this store depends on. Declared
 * structurally (rather than importing TypeORM/Prisma/etc.) so the ORM stays an
 * optional peer — any backend exposing these three row operations works,
 * directly or through a thin wrapper. Implementations should `upsert` (insert or
 * update) so re-persisting an existing session does not collide on the key.
 */
export interface OrmSessionRepository {
  /**
   * Returns the row stored under `key`, or `null`/`undefined` when none exists.
   * Maps to TypeORM `repo.findOne({ where: { key } })` or Prisma
   * `model.findUnique({ where: { key } })`.
   *
   * @param key - The row key to read.
   */
  findByKey(key: string): Awaitable<OrmSessionRow | null | undefined>;

  /**
   * Inserts the row, or updates the existing row's `value` when its `key`
   * already exists (an idempotent upsert). Maps to TypeORM `repo.save(row)` or
   * Prisma `model.upsert(...)`.
   *
   * @param row - The full row (`key` + `value`) to persist.
   */
  upsert(row: OrmSessionRow): Awaitable<unknown>;

  /**
   * Deletes the row under `key` if present (a no-op otherwise). Maps to TypeORM
   * `repo.delete({ key })` or Prisma `model.delete({ where: { key } })`.
   *
   * @param key - The row key to remove.
   */
  deleteByKey(key: string): Awaitable<unknown>;
}

/**
 * Adapts an {@link OrmSessionRepository} into the {@link AsyncKeyValueStore} that
 * {@link KeyValueSessionStore} consumes: row reads become value reads, and
 * writes/deletes pass straight through. Backend errors are left to propagate so
 * {@link KeyValueSessionStore} wraps them in a `TelegramSessionError`.
 *
 * @param repository - The ORM repository to adapt.
 * @returns A key/value view over the repository.
 * @throws Never. (The returned methods may reject if the repository does.)
 */
export function ormRepositoryToKeyValueStore(
  repository: OrmSessionRepository,
): AsyncKeyValueStore {
  return {
    async get(key: string): Promise<string | null | undefined> {
      const row = await repository.findByKey(key);
      // ── A missing row (null/undefined) maps to "no value"; a present row
      //    yields its stored session string. ────────────────────────────────
      return row?.value;
    },
    set(key: string, value: string): Awaitable<unknown> {
      return repository.upsert({ key, value });
    },
    delete(key: string): Awaitable<unknown> {
      return repository.deleteByKey(key);
    },
  };
}

/**
 * Persists the session string to a SQL/ORM-backed row through an injected
 * {@link OrmSessionRepository}. Extends {@link KeyValueSessionStore}, inheriting
 * its load/save/clear semantics (empty value ⇒ no session, errors wrapped in
 * `TelegramSessionError`).
 *
 * For multi-account setups, give each account its own store instance with a
 * distinct `key` (e.g. `nestjs-telegram:session:<account>`); the rows then never
 * collide in the shared table.
 */
export class OrmSessionStore extends KeyValueSessionStore {
  /**
   * @param repository - The ORM repository exposing {@link OrmSessionRepository}.
   * @param key - The row key to store the session under. Defaults to
   *   {@link DEFAULT_KEY_VALUE_SESSION_KEY}; use a per-account value for
   *   multi-account setups.
   */
  public constructor(
    repository: OrmSessionRepository,
    key: string = DEFAULT_KEY_VALUE_SESSION_KEY,
  ) {
    super(ormRepositoryToKeyValueStore(repository), key, 'ORM session store');
  }
}
