/**
 * @file src/lib/bot/web-app/validate-web-app-init-data.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for {@link validateWebAppInitData}. A small, independent signer
 * (mirroring Telegram's documented HMAC-SHA256 scheme) mints known-good fixtures
 * so the tests cover the happy path, tampering, expiry, the `signature`-exclusion
 * rule, and the malformed-input throw paths — all offline.
 */

import { createHmac } from 'node:crypto';
import { TelegramConfigError } from '../../common';
import { WEB_APP_CHAT_TYPES } from './web-app.types';
import { validateWebAppInitData } from './validate-web-app-init-data';

/** A throwaway bot token used to sign and validate the fixtures. */
const BOT_TOKEN = '123456:ABC-DEF_the-quick-brown-fox';

/**
 * Signs a set of (decoded) initData fields exactly as Telegram does, returning
 * the assembled query string. The `hash` is computed over a check-string that
 * excludes `hash` and `signature`.
 *
 * @param fields - Decoded field values (e.g. `user` as a JSON string).
 * @param token - The bot token to sign with.
 * @returns A URL-encoded initData string including the valid `hash`.
 */
function signInitData(
  fields: Record<string, string>,
  token: string = BOT_TOKEN,
): string {
  const checkString = Object.entries(fields)
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

/** Current unix time in seconds. */
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** A representative, valid user JSON blob (compact, as Telegram sends it). */
const USER_JSON = JSON.stringify({
  id: 123456789,
  first_name: 'Jane',
  last_name: 'Doe',
  username: 'jane',
  language_code: 'en',
  is_premium: true,
});

describe('validateWebAppInitData', () => {
  it('returns parsed, typed data for a valid signature', () => {
    const authDate = nowSeconds();
    const initData = signInitData({
      user: USER_JSON,
      auth_date: String(authDate),
      query_id: 'AAH',
      start_param: 'ref42',
      chat_instance: '-123',
      chat_type: 'private',
      can_send_after: '60',
    });

    const data = validateWebAppInitData(initData, BOT_TOKEN);

    expect(data).not.toBeNull();
    expect(data?.user).toEqual({
      id: 123456789,
      firstName: 'Jane',
      lastName: 'Doe',
      username: 'jane',
      languageCode: 'en',
      isPremium: true,
    });
    expect(data?.queryId).toBe('AAH');
    expect(data?.startParam).toBe('ref42');
    expect(data?.chatType).toBe('private');
    expect(data?.chatInstance).toBe('-123');
    expect(data?.canSendAfter).toBe(60);
    expect(data?.authDate).toEqual(new Date(authDate * 1000));
    expect(data?.raw.user).toBe(USER_JSON);
  });

  it('parses an embedded chat object', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      chat: JSON.stringify({
        id: -100123,
        type: 'supergroup',
        title: 'My Group',
        username: 'mygroup',
      }),
    });

    const data = validateWebAppInitData(initData, BOT_TOKEN);

    expect(data?.chat).toEqual({
      id: -100123,
      type: WEB_APP_CHAT_TYPES.SUPERGROUP,
      title: 'My Group',
      username: 'mygroup',
    });
  });

  it('excludes the signature field from the check-string', () => {
    // ── Signed WITHOUT signature in the check-string, but the field is present
    //    in the payload; validation must still pass and surface it. ──────────
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: USER_JSON,
      signature: 'ed25519-sig-value',
    });

    const data = validateWebAppInitData(initData, BOT_TOKEN);

    expect(data).not.toBeNull();
    expect(data?.signature).toBe('ed25519-sig-value');
  });

  it('returns null when a field is tampered after signing', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: USER_JSON,
    });
    // ── Swap the user but keep the original hash. ─────────────────────────────
    const tampered = initData.replace(
      encodeURIComponent(USER_JSON),
      encodeURIComponent(JSON.stringify({ id: 1, first_name: 'Mallory' })),
    );

    expect(validateWebAppInitData(tampered, BOT_TOKEN)).toBeNull();
  });

  it('returns null for a tampered hash', () => {
    const initData = signInitData({ auth_date: String(nowSeconds()) });
    const params = new URLSearchParams(initData);
    const hash = params.get('hash') as string;
    // ── Flip the first hex char. ──────────────────────────────────────────────
    params.set('hash', (hash[0] === '0' ? '1' : '0') + hash.slice(1));

    expect(validateWebAppInitData(params.toString(), BOT_TOKEN)).toBeNull();
  });

  it('returns null for a non-hex / wrong-length hash (fails closed)', () => {
    const initData = signInitData({ auth_date: String(nowSeconds()) });
    const params = new URLSearchParams(initData);
    params.set('hash', 'not-a-valid-hash');

    expect(validateWebAppInitData(params.toString(), BOT_TOKEN)).toBeNull();
  });

  it('returns null when validated against the wrong bot token', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: USER_JSON,
    });

    expect(validateWebAppInitData(initData, '999999:WRONG')).toBeNull();
  });

  it('returns null when data is older than maxAgeSeconds', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds() - 7200),
      user: USER_JSON,
    });

    expect(
      validateWebAppInitData(initData, BOT_TOKEN, { maxAgeSeconds: 3600 }),
    ).toBeNull();
  });

  it('returns data when within maxAgeSeconds', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds() - 60),
      user: USER_JSON,
    });

    const data = validateWebAppInitData(initData, BOT_TOKEN, {
      maxAgeSeconds: 3600,
    });
    expect(data?.user?.id).toBe(123456789);
  });

  it('throws TelegramConfigError when botToken is empty', () => {
    expect(() => validateWebAppInitData('auth_date=1&hash=x', '')).toThrow(
      TelegramConfigError,
    );
  });

  it('throws TelegramConfigError when the hash field is missing', () => {
    expect(() =>
      validateWebAppInitData('auth_date=1&user=%7B%7D', BOT_TOKEN),
    ).toThrow(TelegramConfigError);
  });

  it('throws TelegramConfigError when auth_date is not a number (valid signature)', () => {
    const initData = signInitData({ auth_date: 'soon', user: USER_JSON });
    expect(() => validateWebAppInitData(initData, BOT_TOKEN)).toThrow(
      TelegramConfigError,
    );
  });

  it('throws TelegramConfigError when user JSON is unparseable (valid signature)', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: 'not-json',
    });
    expect(() => validateWebAppInitData(initData, BOT_TOKEN)).toThrow(
      TelegramConfigError,
    );
  });

  it('throws when user is JSON but not an object', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: '[1,2,3]',
    });
    expect(() => validateWebAppInitData(initData, BOT_TOKEN)).toThrow(
      TelegramConfigError,
    );
  });

  it('throws when user is missing required first_name', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: JSON.stringify({ id: 5 }),
    });
    expect(() => validateWebAppInitData(initData, BOT_TOKEN)).toThrow(
      TelegramConfigError,
    );
  });

  it('throws when user is missing a numeric id', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      user: JSON.stringify({ first_name: 'NoId' }),
    });
    expect(() => validateWebAppInitData(initData, BOT_TOKEN)).toThrow(
      TelegramConfigError,
    );
  });

  it('throws when chat has an unrecognised type', () => {
    const initData = signInitData({
      auth_date: String(nowSeconds()),
      chat: JSON.stringify({ id: 1, type: 'wat', title: 'T' }),
    });
    expect(() => validateWebAppInitData(initData, BOT_TOKEN)).toThrow(
      TelegramConfigError,
    );
  });
});
