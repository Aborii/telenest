/**
 * @file src/lib/client/session/encrypted-session-store.ts
 *
 * PURPOSE
 * -------
 * Encryption decorator for any {@link SessionStore}. Encrypts the MTProto
 * session string with AES-256-GCM before delegating persistence to an inner
 * store, and decrypts (with authentication) on the way back out. This protects
 * the credential at rest even if the backing medium — a file, Redis, a DB — is
 * compromised.
 *
 * SECURITY
 * --------
 * - **AES-256-GCM** provides both confidentiality and integrity: a tampered or
 *   truncated ciphertext fails the authentication tag check on decrypt, so the
 *   store **fails closed** ({@link TelegramSessionError}) rather than returning
 *   corrupt data.
 * - A fresh random 96-bit IV is generated per `save`, so encrypting the same
 *   session twice yields different ciphertexts.
 * - The 256-bit content key is derived from the supplied secret via `scrypt`
 *   with a fixed salt, so the same secret always decrypts prior writes. Supply
 *   a high-entropy secret (e.g. 32 random bytes, base64/hex) via an env var;
 *   never hard-code it.
 *
 * USAGE
 * -----
 * ```ts
 * const store = new EncryptedSessionStore(
 *   new RedisSessionStore(redis, 'tg:session'),
 *   process.env.TG_SESSION_KEY!,
 * );
 * ```
 *
 * KEY EXPORTS
 * -----------
 * - EncryptedSessionStore: AES-256-GCM encryption wrapper for a SessionStore.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import { TelegramSessionError } from '../../common';
import type { SessionStore } from './session-store.interface';

/** AES-256-GCM cipher identifier. */
const ALGORITHM = 'aes-256-gcm';
/** AES key length in bytes (256 bits). */
const KEY_LENGTH = 32;
/** GCM initialization-vector length in bytes (96 bits — the GCM standard). */
const IV_LENGTH = 12;
/** GCM authentication-tag length in bytes (128 bits). */
const AUTH_TAG_LENGTH = 16;
/**
 * Marker prefixing every ciphertext so encrypted payloads are self-describing
 * and a future format revision can be detected. Bumped if the layout changes.
 */
const FORMAT_PREFIX = 'tgenc1:';
/**
 * Fixed salt for `scrypt` key derivation. A constant salt is acceptable here:
 * its role is to bind the KDF to this library, and a per-payload random salt
 * would have to be stored alongside the ciphertext anyway. Confidentiality
 * still rests on the secret's entropy.
 */
const KDF_SALT = Buffer.from('nestjs-telegram/session/v1', 'utf8');
/**
 * Minimum accepted secret length in bytes (128 bits). The secret protects a
 * full account credential, so a trivially short value is rejected outright
 * rather than silently stretched into a weak key. Prefer 32 random bytes —
 * scrypt cannot manufacture entropy the secret does not already have.
 */
const MIN_SECRET_BYTES = 16;

/**
 * Wraps an inner {@link SessionStore}, transparently encrypting on `save` and
 * decrypting (with integrity verification) on `load`.
 */
export class EncryptedSessionStore implements SessionStore {
  /** Derived 256-bit content-encryption key. */
  private readonly _key: Buffer;

  /**
   * @param inner - The underlying store that persists the (encrypted) payload.
   * @param secret - The encryption secret (env-sourced string or raw `Buffer`).
   *   Derived into a 256-bit key via `scrypt`. Must be at least
   *   {@link MIN_SECRET_BYTES} bytes; supply a high-entropy value (ideally 32
   *   random bytes, e.g. `crypto.randomBytes(32).toString('base64')`).
   * @throws {TelegramSessionError} If `secret` is shorter than
   *   {@link MIN_SECRET_BYTES} bytes.
   */
  public constructor(
    private readonly inner: SessionStore,
    secret: string | Buffer,
  ) {
    const material =
      typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
    if (material.length < MIN_SECRET_BYTES)
      throw new TelegramSessionError(
        `EncryptedSessionStore requires an encryption secret of at least ` +
          `${MIN_SECRET_BYTES} bytes (got ${material.length}).`,
      );
    // ── Stretch the secret to a fixed 32-byte AES key. scrypt is deterministic
    //    for a given (secret, salt), so prior writes stay decryptable. ────────
    this._key = scryptSync(material, KDF_SALT, KEY_LENGTH);
  }

  /**
   * Loads and decrypts the session from the inner store.
   *
   * @returns The plaintext session string, or `undefined` when none is stored.
   * @throws {TelegramSessionError} If the payload is malformed, was tampered
   *   with, or was written with a different secret (authentication fails).
   */
  public async load(): Promise<string | undefined> {
    const payload = await this.inner.load();
    if (payload === undefined) return undefined;
    return this.decrypt(payload);
  }

  /**
   * Encrypts the session and persists it through the inner store.
   *
   * @param session - The plaintext session string to encrypt and store.
   * @returns Resolves once the encrypted payload is persisted.
   * @throws {TelegramSessionError} If encryption fails or the inner write fails.
   */
  public async save(session: string): Promise<void> {
    await this.inner.save(this.encrypt(session));
  }

  /**
   * Clears the session via the inner store. There is nothing to decrypt.
   *
   * @returns Resolves once cleared.
   * @throws {TelegramSessionError} If the inner delete fails.
   */
  public async clear(): Promise<void> {
    await this.inner.clear();
  }

  /**
   * Encrypts plaintext into the self-describing payload
   * `FORMAT_PREFIX + base64(iv || authTag || ciphertext)`.
   *
   * @param plaintext - The session string to encrypt.
   * @returns The encoded ciphertext payload.
   * @throws {TelegramSessionError} If the cipher operation fails.
   */
  private encrypt(plaintext: string): string {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this._key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const encoded = Buffer.concat([iv, authTag, ciphertext]).toString(
        'base64',
      );
      return `${FORMAT_PREFIX}${encoded}`;
    } catch (error) {
      throw new TelegramSessionError('Failed to encrypt session string.', error);
    }
  }

  /**
   * Decrypts a payload produced by {@link encrypt}, verifying its GCM tag.
   *
   * @param payload - The stored ciphertext payload.
   * @returns The recovered plaintext session string.
   * @throws {TelegramSessionError} If the format prefix is missing, the payload
   *   is too short, or authentication fails (tamper / wrong key).
   */
  private decrypt(payload: string): string {
    if (!this.hasFormatPrefix(payload))
      throw new TelegramSessionError(
        'Stored session is not an EncryptedSessionStore payload (bad prefix).',
      );

    const raw = Buffer.from(payload.slice(FORMAT_PREFIX.length), 'base64');
    if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH)
      throw new TelegramSessionError(
        'Encrypted session payload is truncated or malformed.',
      );

    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    try {
      const decipher = createDecipheriv(ALGORITHM, this._key, iv);
      decipher.setAuthTag(authTag);
      // ── `final()` throws if the auth tag does not verify — i.e. the payload
      //    was tampered with or encrypted under a different key. ──────────────
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch (error) {
      throw new TelegramSessionError(
        'Failed to decrypt session: payload was tampered with or the ' +
          'encryption secret is wrong.',
        error,
      );
    }
  }

  /**
   * Constant-time check that `payload` carries the expected {@link FORMAT_PREFIX}.
   *
   * @param payload - The stored value to inspect.
   * @returns `true` when the prefix matches.
   * @throws Never.
   */
  private hasFormatPrefix(payload: string): boolean {
    if (payload.length < FORMAT_PREFIX.length) return false;
    const candidate = Buffer.from(
      payload.slice(0, FORMAT_PREFIX.length),
      'utf8',
    );
    const expected = Buffer.from(FORMAT_PREFIX, 'utf8');
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  }
}
