/**
 * @file src/lib/client/gramjs-client.adapter.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the GramJS adapter. The GramJS `TelegramClient` is mocked, so
 * no network or real MTProto session is involved, but real `Api.*` classes are
 * used where `instanceof` checks matter (peers, sign-up-required, user-empty).
 * The tests focus on the adapter's two jobs: DTO mapping and error translation.
 */

import { Api, errors, password, sessions, type TelegramClient } from 'telegram';

import { TelegramAuthError, TelegramClientError } from '../common';
import {
  createGramJsClient,
  GramJsClientAdapter,
} from './gramjs-client.adapter';

// ── big-integer uses `export =` (CommonJS); the project omits esModuleInterop,
//    so the import-equals form is required for the call to resolve at runtime. ─
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see note above: `export =` interop requires the import-equals form.
import bigInt = require('big-integer');

/** Minimal mock of the GramJS client surface the adapter calls. */
type MockClient = {
  connect: jest.Mock;
  disconnect: jest.Mock;
  checkAuthorization: jest.Mock;
  sendCode: jest.Mock;
  signInUserWithQrCode: jest.Mock;
  signInBot: jest.Mock;
  updateTwoFaSettings: jest.Mock;
  invoke: jest.Mock;
  getMe: jest.Mock;
  getDialogs: jest.Mock;
  getMessages: jest.Mock;
  sendMessage: jest.Mock;
  sendFile: jest.Mock;
  downloadMedia: jest.Mock;
  downloadProfilePhoto: jest.Mock;
  getParticipants: jest.Mock;
  getEntity: jest.Mock;
  editMessage: jest.Mock;
  deleteMessages: jest.Mock;
  forwardMessages: jest.Mock;
  markAsRead: jest.Mock;
  pinMessage: jest.Mock;
  iterDownload: jest.Mock;
  addEventHandler: jest.Mock;
  removeEventHandler: jest.Mock;
};

/** Builds a mock client with overridable jest fns. */
function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    checkAuthorization: jest.fn().mockResolvedValue(true),
    sendCode: jest.fn(),
    signInUserWithQrCode: jest.fn(),
    signInBot: jest.fn(),
    updateTwoFaSettings: jest.fn(),
    invoke: jest.fn(),
    getMe: jest.fn(),
    getDialogs: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    sendFile: jest.fn(),
    downloadMedia: jest.fn(),
    downloadProfilePhoto: jest.fn(),
    getParticipants: jest.fn(),
    getEntity: jest.fn(),
    editMessage: jest.fn(),
    deleteMessages: jest.fn(),
    forwardMessages: jest.fn(),
    markAsRead: jest.fn(),
    pinMessage: jest.fn(),
    iterDownload: jest.fn(),
    addEventHandler: jest.fn(),
    removeEventHandler: jest.fn(),
    ...overrides,
  };
}

/** A lazy async-iterable over fixed chunks, modelling `client.iterDownload`. */
function asyncChunks(...chunks: Buffer[]): AsyncIterable<Buffer> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

/** A `MessageMediaDocument` fixture carrying the fields the adapter reads. */
function documentMedia(
  doc: Partial<Api.Document> = {},
  attributes: Api.TypeDocumentAttribute[] = [],
): Api.TypeMessageMedia {
  return asEntity(Api.MessageMediaDocument, {
    document: asEntity(Api.Document, {
      size: bigInt(1_048_576),
      mimeType: 'video/mp4',
      attributes,
      ...doc,
    }),
  });
}

/** Wraps a mock client in a freshly-constructed adapter. */
function createAdapter(mock: MockClient): GramJsClientAdapter {
  return new GramJsClientAdapter(
    mock as unknown as TelegramClient,
    new sessions.StringSession(''),
    { apiId: 1, apiHash: 'hash' },
  );
}

/**
 * Builds an `Api.*` instance carrying only the fields a test needs, with the
 * correct prototype so the adapter's `instanceof` checks pass — without having
 * to satisfy every required constructor field.
 *
 * @param ctor - The `Api.*` class whose prototype to use.
 * @param fields - The subset of fields the adapter reads.
 * @returns An object that is `instanceof ctor`.
 */
function asEntity<T extends object>(
  ctor: { prototype: T },
  fields: Partial<T>,
): T {
  return Object.assign(Object.create(ctor.prototype) as T, fields);
}

/** A GramJS message-like fixture with optional non-empty media. */
function aRawMessage(
  overrides: Partial<{
    id: number;
    peerId: Api.TypePeer;
    message: string;
    date: number;
    out: boolean;
    senderId: ReturnType<typeof bigInt> | undefined;
    media: Api.TypeMessageMedia | undefined;
  }> = {},
): unknown {
  return {
    id: 1,
    peerId: new Api.PeerUser({ userId: bigInt('1001') }),
    message: 'hi',
    date: 1700000000,
    out: true,
    senderId: bigInt('1001'),
    media: undefined,
    ...overrides,
  };
}

describe('GramJsClientAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('connection lifecycle', () => {
    it('connects once and tracks state', async () => {
      const mock = createMockClient();
      const adapter = createAdapter(mock);

      expect(adapter.isConnected()).toBe(false);
      await adapter.connect();
      await adapter.connect();

      expect(mock.connect).toHaveBeenCalledTimes(1);
      expect(adapter.isConnected()).toBe(true);
    });

    it('disconnects and clears state, swallowing errors', async () => {
      const mock = createMockClient({
        disconnect: jest.fn().mockRejectedValue(new Error('socket')),
      });
      const adapter = createAdapter(mock);
      await adapter.connect();

      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(false);
    });

    it('wraps connect failures in TelegramClientError', async () => {
      const mock = createMockClient({
        connect: jest.fn().mockRejectedValue(new Error('no route')),
      });
      const adapter = createAdapter(mock);
      await expect(adapter.connect()).rejects.toBeInstanceOf(
        TelegramClientError,
      );
    });

    it('isAuthorized delegates to checkAuthorization', async () => {
      const mock = createMockClient({
        checkAuthorization: jest.fn().mockResolvedValue(true),
      });
      await expect(createAdapter(mock).isAuthorized()).resolves.toBe(true);
    });

    it('wraps isAuthorized failures in TelegramClientError', async () => {
      const mock = createMockClient({
        checkAuthorization: jest.fn().mockRejectedValue(new Error('rpc')),
      });
      await expect(createAdapter(mock).isAuthorized()).rejects.toBeInstanceOf(
        TelegramClientError,
      );
    });
  });

  describe('sendCode', () => {
    it('forwards credentials and maps the result', async () => {
      const mock = createMockClient({
        sendCode: jest
          .fn()
          .mockResolvedValue({ phoneCodeHash: 'H', isCodeViaApp: true }),
      });
      const adapter = createAdapter(mock);

      const result = await adapter.sendCode('+15551234567');

      expect(mock.sendCode).toHaveBeenCalledWith(
        { apiId: 1, apiHash: 'hash' },
        '+15551234567',
        false,
      );
      expect(result).toEqual({ phoneCodeHash: 'H', isCodeViaApp: true });
    });

    it('maps PHONE_NUMBER_INVALID to a PHONE_INVALID auth error', async () => {
      const mock = createMockClient({
        sendCode: jest
          .fn()
          .mockRejectedValue(new Error('PHONE_NUMBER_INVALID')),
      });
      const adapter = createAdapter(mock);

      const error = await adapter.sendCode('+1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramAuthError);
      expect((error as TelegramAuthError).code).toBe('PHONE_INVALID');
    });

    it('maps a real GramJS FloodWaitError to FLOOD_WAIT with seconds', async () => {
      // ── FloodWaitError.errorMessage is the bare string "FLOOD"; the delay is
      //    only on `.seconds`, so this proves the type-based detection. ───────
      const flood = new errors.FloodWaitError({
        request: new Api.auth.SignIn({
          phoneNumber: '+1',
          phoneCodeHash: 'H',
          phoneCode: '1',
        }),
        capture: 30,
      });
      const mock = createMockClient({
        sendCode: jest.fn().mockRejectedValue(flood),
      });

      const error = (await createAdapter(mock)
        .sendCode('+1')
        .catch((e: unknown) => e)) as TelegramAuthError;
      expect(error.code).toBe('FLOOD_WAIT');
      expect(error.retryAfterSeconds).toBe(30);
    });

    it('parses FLOOD_WAIT seconds from a plain message (regex fallback)', async () => {
      const mock = createMockClient({
        sendCode: jest.fn().mockRejectedValue(new Error('FLOOD_WAIT_45')),
      });

      const error = (await createAdapter(mock)
        .sendCode('+1')
        .catch((e: unknown) => e)) as TelegramAuthError;
      expect(error.code).toBe('FLOOD_WAIT');
      expect(error.retryAfterSeconds).toBe(45);
    });
  });

  describe('signInWithCode', () => {
    it('returns authorized with a mapped user', async () => {
      const mock = createMockClient({
        invoke: jest.fn().mockResolvedValue({
          user: { id: bigInt('1001'), self: true, firstName: 'Ada' },
        }),
      });
      const adapter = createAdapter(mock);

      const result = await adapter.signInWithCode({
        phoneNumber: '+1',
        phoneCodeHash: 'H',
        phoneCode: '123',
      });

      expect(result.status).toBe('authorized');
      if (result.status === 'authorized') {
        expect(result.user.id).toBe('1001');
        expect(result.user.isSelf).toBe(true);
        expect(result.user.firstName).toBe('Ada');
      }
    });

    it('returns password-required on SESSION_PASSWORD_NEEDED', async () => {
      const mock = createMockClient({
        invoke: jest
          .fn()
          .mockRejectedValue(new Error('SESSION_PASSWORD_NEEDED')),
      });
      const adapter = createAdapter(mock);

      const result = await adapter.signInWithCode({
        phoneNumber: '+1',
        phoneCodeHash: 'H',
        phoneCode: '123',
      });
      expect(result.status).toBe('password-required');
    });

    it('maps PHONE_CODE_INVALID to a CODE_INVALID auth error', async () => {
      const mock = createMockClient({
        invoke: jest.fn().mockRejectedValue(new Error('PHONE_CODE_INVALID')),
      });
      const adapter = createAdapter(mock);

      const error = await adapter
        .signInWithCode({
          phoneNumber: '+1',
          phoneCodeHash: 'H',
          phoneCode: 'x',
        })
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('CODE_INVALID');
    });

    it('falls back to String() for a non-Error rejection', async () => {
      const mock = createMockClient({
        sendCode: jest.fn().mockRejectedValue('weird-non-error-failure'),
      });

      const error = (await createAdapter(mock)
        .sendCode('+1')
        .catch((e: unknown) => e)) as TelegramAuthError;
      expect(error.code).toBe('UNKNOWN');
      expect(error.message).toContain('weird-non-error-failure');
    });

    it('throws SIGN_UP_REQUIRED for unregistered numbers', async () => {
      const mock = createMockClient({
        invoke: jest
          .fn()
          .mockResolvedValue(new Api.auth.AuthorizationSignUpRequired({})),
      });
      const adapter = createAdapter(mock);

      const error = await adapter
        .signInWithCode({
          phoneNumber: '+1',
          phoneCodeHash: 'H',
          phoneCode: '1',
        })
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('SIGN_UP_REQUIRED');
    });
  });

  describe('signInWithPassword', () => {
    it('computes the SRP check and maps the returned user', async () => {
      // ── invoke #1 = account.GetPassword, invoke #2 = auth.CheckPassword. The
      //    SRP computation is stubbed so the second invoke (and mapUser) run. ─
      const invoke = jest
        .fn()
        .mockResolvedValueOnce({ srp_id: bigInt('1') })
        .mockResolvedValueOnce({
          user: { id: bigInt('2002'), self: true, username: 'me' },
        });
      const computeSpy = jest.spyOn(password, 'computeCheck').mockResolvedValue(
        new Api.InputCheckPasswordSRP({
          srpId: bigInt('1'),
          A: Buffer.alloc(1),
          M1: Buffer.alloc(1),
        }),
      );
      const adapter = createAdapter(createMockClient({ invoke }));

      const user = await adapter.signInWithPassword('hunter2');

      expect(computeSpy).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(user.id).toBe('2002');
      expect(user.username).toBe('me');
    });

    it('throws SIGN_UP_REQUIRED if 2FA resolves to sign-up-required', async () => {
      const invoke = jest
        .fn()
        .mockResolvedValueOnce({ srp_id: bigInt('1') })
        .mockResolvedValueOnce(new Api.auth.AuthorizationSignUpRequired({}));
      jest.spyOn(password, 'computeCheck').mockResolvedValue(
        new Api.InputCheckPasswordSRP({
          srpId: bigInt('1'),
          A: Buffer.alloc(1),
          M1: Buffer.alloc(1),
        }),
      );
      const adapter = createAdapter(createMockClient({ invoke }));

      const error = await adapter
        .signInWithPassword('pw')
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('SIGN_UP_REQUIRED');
    });

    it('maps PASSWORD_HASH_INVALID to a PASSWORD_INVALID auth error', async () => {
      // ── The first invoke (GetPassword) rejecting short-circuits the SRP
      //    computation and exercises the auth-error mapping path. ────────────
      const mock = createMockClient({
        invoke: jest.fn().mockRejectedValue(new Error('PASSWORD_HASH_INVALID')),
      });
      const adapter = createAdapter(mock);

      const error = await adapter
        .signInWithPassword('pw')
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('PASSWORD_INVALID');
    });
  });

  describe('signInWithQrCode', () => {
    it('emits a base64url token + tg://login url and maps the user', async () => {
      // ── Drive GramJS' qrCode callback with raw token bytes, then resolve. ──
      const rawToken = Buffer.from([0xfb, 0xff, 0xbf]); // bytes that yield '-' and '_'
      const signInUserWithQrCode = jest
        .fn()
        .mockImplementation(async (_creds, params) => {
          await params.qrCode({ token: rawToken, expires: 1234 });
          return { id: bigInt('77'), self: true, firstName: 'Qr' };
        });
      const adapter = createAdapter(createMockClient({ signInUserWithQrCode }));

      const tokens: Array<{ token: string; url: string; expires: number }> = [];
      const user = await adapter.signInWithQrCode({
        onToken: (t) => tokens.push(t),
      });

      const encoded = rawToken.toString('base64url');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toEqual({
        token: encoded,
        url: `tg://login?token=${encoded}`,
        expires: 1234,
      });
      // ── base64url must not contain '+' or '/' (standard-base64 chars). ─────
      expect(tokens[0]?.token).not.toMatch(/[+/]/);
      expect(user.id).toBe('77');
      expect(user.firstName).toBe('Qr');
    });

    it('forwards the onPassword callback to GramJS for 2FA accounts', async () => {
      const onPassword = jest.fn().mockResolvedValue('hunter2');
      const signInUserWithQrCode = jest
        .fn()
        .mockImplementation(async (_creds, params) => {
          // ── GramJS calls `password(hint)` when the scanned account has 2FA. ─
          const pw = await params.password('my-hint');
          expect(pw).toBe('hunter2');
          return { id: bigInt('5'), self: true };
        });
      const adapter = createAdapter(createMockClient({ signInUserWithQrCode }));

      await adapter.signInWithQrCode({ onToken: jest.fn(), onPassword });
      expect(onPassword).toHaveBeenCalledWith('my-hint');
    });

    it('maps a captured wrong-password error to PASSWORD_INVALID', async () => {
      // ── GramJS surfaces real failures through `onError` (not a rejection);
      //    we stop the loop and map the captured error, not "AUTH_USER_CANCEL". ─
      const signInUserWithQrCode = jest
        .fn()
        .mockImplementation(async (_creds, params) => {
          await params.onError(new Error('PASSWORD_HASH_INVALID'));
          throw new Error('AUTH_USER_CANCEL');
        });
      const adapter = createAdapter(createMockClient({ signInUserWithQrCode }));

      const error = await adapter
        .signInWithQrCode({ onToken: jest.fn() })
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('PASSWORD_INVALID');
    });

    it('maps a 2FA account without onPassword to PASSWORD_REQUIRED', async () => {
      const signInUserWithQrCode = jest
        .fn()
        .mockRejectedValue(new Error('Account has 2FA enabled.'));
      const adapter = createAdapter(createMockClient({ signInUserWithQrCode }));

      const error = await adapter
        .signInWithQrCode({ onToken: jest.fn() })
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('PASSWORD_REQUIRED');
    });

    it('maps a direct rejection (no onError, not 2FA) via the error fallback', async () => {
      // ── GramJS rejects without invoking onError: capturedError stays
      //    undefined, so the `?? error` fallback maps the thrown error. ───────
      const signInUserWithQrCode = jest
        .fn()
        .mockRejectedValue(new Error('TIMEOUT'));
      const adapter = createAdapter(createMockClient({ signInUserWithQrCode }));

      const error = await adapter
        .signInWithQrCode({ onToken: jest.fn() })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramAuthError);
      expect((error as TelegramAuthError).code).toBe('UNKNOWN');
    });
  });

  describe('signInAsBot', () => {
    it('passes the bot token and maps the returned bot user', async () => {
      const signInBot = jest
        .fn()
        .mockResolvedValue({ id: bigInt('42'), bot: true, username: 'mybot' });
      const adapter = createAdapter(createMockClient({ signInBot }));

      const user = await adapter.signInAsBot('123:ABC');

      expect(signInBot).toHaveBeenCalledWith(
        { apiId: 1, apiHash: 'hash' },
        { botAuthToken: '123:ABC' },
      );
      expect(user.id).toBe('42');
      expect(user.isBot).toBe(true);
      expect(user.username).toBe('mybot');
    });

    it('maps a rejected token to an auth error', async () => {
      const signInBot = jest
        .fn()
        .mockRejectedValue(new Error('ACCESS_TOKEN_INVALID'));
      const adapter = createAdapter(createMockClient({ signInBot }));

      const error = await adapter.signInAsBot('bad').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramAuthError);
      expect((error as TelegramAuthError).code).toBe('UNKNOWN');
    });
  });

  describe('updateTwoFactor', () => {
    it('forwards current/new password and hint to GramJS', async () => {
      const updateTwoFaSettings = jest.fn().mockResolvedValue(undefined);
      const adapter = createAdapter(createMockClient({ updateTwoFaSettings }));

      await adapter.updateTwoFactor({
        currentPassword: 'old',
        newPassword: 'new',
        hint: 'h',
      });

      expect(updateTwoFaSettings).toHaveBeenCalledWith({
        currentPassword: 'old',
        newPassword: 'new',
        hint: 'h',
      });
    });

    it('maps a wrong current password to PASSWORD_INVALID', async () => {
      const updateTwoFaSettings = jest
        .fn()
        .mockRejectedValue(new Error('PASSWORD_HASH_INVALID'));
      const adapter = createAdapter(createMockClient({ updateTwoFaSettings }));

      const error = await adapter
        .updateTwoFactor({ currentPassword: 'wrong', newPassword: 'x' })
        .catch((e: unknown) => e);
      expect((error as TelegramAuthError).code).toBe('PASSWORD_INVALID');
    });
  });

  describe('logOut', () => {
    it('invokes auth.LogOut', async () => {
      const mock = createMockClient({
        invoke: jest.fn().mockResolvedValue(true),
      });
      const adapter = createAdapter(mock);
      await adapter.logOut();
      expect(mock.invoke).toHaveBeenCalledTimes(1);
    });

    it('wraps failures in TelegramClientError', async () => {
      const mock = createMockClient({
        invoke: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const adapter = createAdapter(mock);
      await expect(adapter.logOut()).rejects.toBeInstanceOf(
        TelegramClientError,
      );
    });
  });

  describe('data mapping', () => {
    it('maps getMe into a GramUser', async () => {
      const mock = createMockClient({
        getMe: jest.fn().mockResolvedValue({
          id: bigInt('1001'),
          self: true,
          bot: false,
          premium: true,
          firstName: 'Ada',
          lastName: 'L',
          username: 'ada',
          phone: '100',
        }),
      });
      const adapter = createAdapter(mock);

      await expect(adapter.getMe()).resolves.toEqual({
        id: '1001',
        isSelf: true,
        isBot: false,
        isPremium: true,
        firstName: 'Ada',
        lastName: 'L',
        username: 'ada',
        phone: '100',
      });
    });

    it('maps a UserEmpty into a minimal GramUser', async () => {
      const mock = createMockClient({
        getMe: jest
          .fn()
          .mockResolvedValue(new Api.UserEmpty({ id: bigInt('0') })),
      });
      const adapter = createAdapter(mock);

      await expect(adapter.getMe()).resolves.toEqual({
        id: '0',
        isSelf: false,
        isBot: false,
        isPremium: false,
      });
    });

    it('maps dialogs with the correct type discriminator', async () => {
      const mock = createMockClient({
        getDialogs: jest.fn().mockResolvedValue([
          {
            isChannel: false,
            isGroup: true,
            isUser: false,
            id: bigInt('5'),
            title: 'My Group',
            name: '',
            unreadCount: 3,
            pinned: true,
          },
        ]),
      });
      const adapter = createAdapter(mock);

      await expect(adapter.getDialogs()).resolves.toEqual([
        {
          id: '5',
          title: 'My Group',
          type: 'group',
          unreadCount: 3,
          pinned: true,
        },
      ]);
    });

    it('maps messages and resolves the peer id', async () => {
      const mock = createMockClient({
        getMessages: jest.fn().mockResolvedValue([
          {
            id: 7,
            peerId: new Api.PeerUser({ userId: bigInt('1001') }),
            message: 'hi',
            date: 1700000000,
            out: true,
            senderId: bigInt('1001'),
          },
        ]),
      });
      const adapter = createAdapter(mock);

      await expect(adapter.getMessages('me')).resolves.toEqual([
        {
          id: 7,
          peerId: '1001',
          text: 'hi',
          date: 1700000000,
          out: true,
          senderId: '1001',
          hasMedia: false,
        },
      ]);
    });

    it('maps a sent message', async () => {
      const mock = createMockClient({
        sendMessage: jest.fn().mockResolvedValue({
          id: 9,
          peerId: new Api.PeerChannel({ channelId: bigInt('222') }),
          message: 'sent',
          date: 1700000001,
          out: true,
          senderId: undefined,
        }),
      });
      const adapter = createAdapter(mock);

      await expect(
        adapter.sendMessage('@x', { message: 'sent' }),
      ).resolves.toEqual({
        id: 9,
        peerId: '222',
        text: 'sent',
        date: 1700000001,
        out: true,
        senderId: undefined,
        hasMedia: false,
      });
    });

    it('resolves a PeerChat id when mapping messages', async () => {
      const mock = createMockClient({
        getMessages: jest.fn().mockResolvedValue([
          {
            id: 1,
            peerId: new Api.PeerChat({ chatId: bigInt('888') }),
            message: '',
            date: 1,
            out: false,
            senderId: undefined,
          },
        ]),
      });
      const [message] = await createAdapter(mock).getMessages(888);
      expect(message?.peerId).toBe('888');
      expect(message?.text).toBe('');
    });

    it.each([
      [{ isChannel: true, isGroup: false, isUser: false }, 'channel'],
      [{ isChannel: false, isGroup: true, isUser: false }, 'group'],
      [{ isChannel: false, isGroup: false, isUser: true }, 'user'],
    ])('maps dialog flags %o to type %s', async (flags, expected) => {
      const mock = createMockClient({
        getDialogs: jest.fn().mockResolvedValue([
          {
            ...flags,
            id: bigInt('1'),
            title: 'T',
            name: '',
            unreadCount: 0,
            pinned: false,
          },
        ]),
      });
      const [dialog] = await createAdapter(mock).getDialogs();
      expect(dialog?.type).toBe(expected);
    });

    it('falls back to name then "" for missing dialog id/title', async () => {
      const mock = createMockClient({
        getDialogs: jest.fn().mockResolvedValue([
          {
            isChannel: false,
            isGroup: false,
            isUser: true,
            id: undefined,
            title: undefined,
            name: 'Named',
            unreadCount: 0,
            pinned: false,
          },
        ]),
      });
      const [dialog] = await createAdapter(mock).getDialogs();
      expect(dialog?.id).toBe('');
      expect(dialog?.title).toBe('Named');
    });

    it.each([
      ['getMe', (a: GramJsClientAdapter): Promise<unknown> => a.getMe()],
      [
        'getMessages',
        (a: GramJsClientAdapter): Promise<unknown> => a.getMessages('me'),
      ],
      [
        'sendMessage',
        (a: GramJsClientAdapter): Promise<unknown> =>
          a.sendMessage('me', { message: 'x' }),
      ],
    ])('wraps %s failures in TelegramClientError', async (method, call) => {
      const mock = createMockClient({
        [method]: jest.fn().mockRejectedValue(new Error('rpc')),
      } as Partial<MockClient>);
      await expect(call(createAdapter(mock))).rejects.toBeInstanceOf(
        TelegramClientError,
      );
    });

    it('maps an unresolvable peer id to an empty string', async () => {
      const mock = createMockClient({
        getMessages: jest.fn().mockResolvedValue([
          {
            id: 1,
            peerId: {},
            message: 'x',
            date: 1,
            out: false,
            senderId: undefined,
          },
        ]),
      });
      const [message] = await createAdapter(mock).getMessages('me');
      expect(message?.peerId).toBe('');
    });

    it('wraps getDialogs failures in TelegramClientError', async () => {
      const mock = createMockClient({
        getDialogs: jest.fn().mockRejectedValue(new Error('rpc')),
      });
      const adapter = createAdapter(mock);
      await expect(adapter.getDialogs()).rejects.toBeInstanceOf(
        TelegramClientError,
      );
    });
  });

  describe('exportSession', () => {
    it('returns a string for an empty session', () => {
      const adapter = createAdapter(createMockClient());
      expect(typeof adapter.exportSession()).toBe('string');
    });
  });

  describe('createGramJsClient', () => {
    it('builds a disconnected IGramClient with no network access', () => {
      const client = createGramJsClient(
        { apiId: 1, apiHash: 'hash', deviceModel: 'Test', useWSS: true },
        '',
      );
      expect(client).toBeInstanceOf(GramJsClientAdapter);
      expect(client.isConnected()).toBe(false);
      expect(typeof client.getMe).toBe('function');
      expect(typeof client.sendMessage).toBe('function');
      expect(typeof client.exportSession()).toBe('string');
    });
  });

  describe('onNewMessage', () => {
    it('registers a NewMessage handler and maps the event message', () => {
      const mock = createMockClient();
      const adapter = createAdapter(mock);
      const received: unknown[] = [];

      adapter.onNewMessage((message) => received.push(message));

      expect(mock.addEventHandler).toHaveBeenCalledTimes(1);

      // ── Simulate GramJS delivering a NewMessageEvent to the registered cb. ──
      const callback = mock.addEventHandler.mock.calls[0]?.[0] as (
        event: unknown,
      ) => void;
      callback({
        message: {
          id: 7,
          peerId: new Api.PeerUser({ userId: bigInt('1001') }),
          message: 'hi there',
          date: 5,
          out: false,
          senderId: bigInt('1001'),
        },
      });

      expect(received).toEqual([
        {
          id: 7,
          peerId: '1001',
          text: 'hi there',
          date: 5,
          out: false,
          senderId: '1001',
          hasMedia: false,
        },
      ]);
    });

    it('unsubscribe removes the event handler', () => {
      const mock = createMockClient();
      const adapter = createAdapter(mock);

      const unsubscribe = adapter.onNewMessage(() => undefined);
      const registeredCb = mock.addEventHandler.mock.calls[0]?.[0];
      unsubscribe();

      expect(mock.removeEventHandler).toHaveBeenCalledTimes(1);
      expect(mock.removeEventHandler.mock.calls[0]?.[0]).toBe(registeredCb);
    });
  });

  describe('media operations', () => {
    it('flags non-empty media via hasMedia when mapping', async () => {
      const mock = createMockClient({
        getMessages: jest
          .fn()
          .mockResolvedValue([aRawMessage({ media: new Api.MessageMediaPhoto({}) })]),
      });
      const [message] = await createAdapter(mock).getMessages('me');
      expect(message?.hasMedia).toBe(true);
    });

    it('treats MessageMediaEmpty as no media', async () => {
      const mock = createMockClient({
        getMessages: jest
          .fn()
          .mockResolvedValue([aRawMessage({ media: new Api.MessageMediaEmpty() })]),
      });
      const [message] = await createAdapter(mock).getMessages('me');
      expect(message?.hasMedia).toBe(false);
    });

    it('sendFile maps the message and sends asPhoto as forceDocument:false', async () => {
      const mock = createMockClient({
        sendFile: jest
          .fn()
          .mockResolvedValue(
            aRawMessage({ id: 3, media: new Api.MessageMediaPhoto({}) }),
          ),
      });

      const sent = await createAdapter(mock).sendFile('me', {
        file: 'photo.jpg',
        caption: 'hey',
        asPhoto: true,
      });

      expect(sent.id).toBe(3);
      expect(sent.hasMedia).toBe(true);
      expect(mock.sendFile).toHaveBeenCalledWith(
        'me',
        expect.objectContaining({
          file: 'photo.jpg',
          caption: 'hey',
          forceDocument: false,
        }),
      );
    });

    it('sendFile forces a document when asPhoto is false', async () => {
      const mock = createMockClient({
        sendFile: jest.fn().mockResolvedValue(aRawMessage()),
      });
      await createAdapter(mock).sendFile('me', { file: 'a.bin', asPhoto: false });
      expect(mock.sendFile.mock.calls[0]?.[1]).toMatchObject({
        forceDocument: true,
      });
    });

    it('sendFile leaves forceDocument undefined when asPhoto is omitted', async () => {
      const mock = createMockClient({
        sendFile: jest.fn().mockResolvedValue(aRawMessage()),
      });
      await createAdapter(mock).sendFile('me', { file: 'a.bin' });
      expect(mock.sendFile.mock.calls[0]?.[1].forceDocument).toBeUndefined();
    });

    it('downloadMedia fetches the message and returns its bytes', async () => {
      const buffer = Buffer.from('PNGDATA');
      const mock = createMockClient({
        getMessages: jest
          .fn()
          .mockResolvedValue([aRawMessage({ media: new Api.MessageMediaPhoto({}) })]),
        downloadMedia: jest.fn().mockResolvedValue(buffer),
      });
      await expect(createAdapter(mock).downloadMedia('me', 1)).resolves.toBe(
        buffer,
      );
      expect(mock.getMessages).toHaveBeenCalledWith('me', { ids: [1] });
    });

    it('downloadMedia returns undefined when the message is missing', async () => {
      const mock = createMockClient({
        getMessages: jest.fn().mockResolvedValue([]),
      });
      await expect(
        createAdapter(mock).downloadMedia('me', 9),
      ).resolves.toBeUndefined();
    });

    it('downloadMedia returns undefined (and never downloads) without media', async () => {
      const mock = createMockClient({
        getMessages: jest.fn().mockResolvedValue([aRawMessage()]),
        downloadMedia: jest.fn(),
      });
      await expect(
        createAdapter(mock).downloadMedia('me', 1),
      ).resolves.toBeUndefined();
      expect(mock.downloadMedia).not.toHaveBeenCalled();
    });

    it('downloadMedia returns undefined when GramJS resolves a non-Buffer', async () => {
      const mock = createMockClient({
        getMessages: jest
          .fn()
          .mockResolvedValue([aRawMessage({ media: new Api.MessageMediaPhoto({}) })]),
        downloadMedia: jest.fn().mockResolvedValue('/tmp/path'),
      });
      await expect(
        createAdapter(mock).downloadMedia('me', 1),
      ).resolves.toBeUndefined();
    });

    it('downloadProfilePhoto returns bytes, or undefined when absent', async () => {
      const buffer = Buffer.from('JPEG');
      const withPhoto = createMockClient({
        downloadProfilePhoto: jest.fn().mockResolvedValue(buffer),
      });
      const without = createMockClient({
        downloadProfilePhoto: jest.fn().mockResolvedValue(undefined),
      });
      await expect(
        createAdapter(withPhoto).downloadProfilePhoto('me'),
      ).resolves.toBe(buffer);
      await expect(
        createAdapter(without).downloadProfilePhoto('me'),
      ).resolves.toBeUndefined();
    });

    it('wraps downloadMedia failures in TelegramClientError', async () => {
      const mock = createMockClient({
        getMessages: jest.fn().mockRejectedValue(new Error('rpc')),
      });
      await expect(
        createAdapter(mock).downloadMedia('me', 1),
      ).rejects.toBeInstanceOf(TelegramClientError);
    });

    it.each([
      [
        'sendFile',
        (a: GramJsClientAdapter): Promise<unknown> =>
          a.sendFile('me', { file: 'x' }),
      ],
      [
        'downloadProfilePhoto',
        (a: GramJsClientAdapter): Promise<unknown> =>
          a.downloadProfilePhoto('me'),
      ],
    ])('wraps %s failures in TelegramClientError', async (method, call) => {
      const mock = createMockClient({
        [method]: jest.fn().mockRejectedValue(new Error('rpc')),
      } as Partial<MockClient>);
      await expect(call(createAdapter(mock))).rejects.toBeInstanceOf(
        TelegramClientError,
      );
    });
  });

  describe('chat & channel operations', () => {
    it('joinChannel invokes channels.JoinChannel', async () => {
      const mock = createMockClient({
        invoke: jest.fn().mockResolvedValue(undefined),
      });
      await createAdapter(mock).joinChannel('@chan');
      expect(mock.invoke.mock.calls[0]?.[0]).toBeInstanceOf(
        Api.channels.JoinChannel,
      );
    });

    it('leaveChannel invokes channels.LeaveChannel', async () => {
      const mock = createMockClient({
        invoke: jest.fn().mockResolvedValue(undefined),
      });
      await createAdapter(mock).leaveChannel('@chan');
      expect(mock.invoke.mock.calls[0]?.[0]).toBeInstanceOf(
        Api.channels.LeaveChannel,
      );
    });

    it('getParticipants maps users and forwards limit/search', async () => {
      const mock = createMockClient({
        getParticipants: jest.fn().mockResolvedValue([
          { id: bigInt('1'), self: false, firstName: 'A' },
          new Api.UserEmpty({ id: bigInt('2') }),
        ]),
      });
      const users = await createAdapter(mock).getParticipants('@g', {
        limit: 5,
        search: 'a',
      });
      expect(users).toEqual([
        { id: '1', isSelf: false, isBot: false, isPremium: false, firstName: 'A' },
        { id: '2', isSelf: false, isBot: false, isPremium: false },
      ]);
      expect(mock.getParticipants).toHaveBeenCalledWith('@g', {
        limit: 5,
        search: 'a',
      });
    });

    it('searchMessages maps results and forwards the query', async () => {
      const mock = createMockClient({
        getMessages: jest
          .fn()
          .mockResolvedValue([aRawMessage({ id: 11, message: 'found' })]),
      });
      const [message] = await createAdapter(mock).searchMessages('@g', 'find', {
        limit: 3,
      });
      expect(message?.text).toBe('found');
      expect(mock.getMessages).toHaveBeenCalledWith('@g', {
        search: 'find',
        limit: 3,
      });
    });

    it('getFullChat maps a user (bio from GetFullUser)', async () => {
      const user = asEntity(Api.User, {
        id: bigInt('5'),
        firstName: 'Ada',
        lastName: 'L',
        username: 'ada',
        verified: true,
      });
      const mock = createMockClient({
        getEntity: jest.fn().mockResolvedValue(user),
        invoke: jest.fn().mockResolvedValue({ fullUser: { about: 'hi there' } }),
      });
      await expect(createAdapter(mock).getFullChat('@ada')).resolves.toEqual({
        id: '5',
        type: 'user',
        title: 'Ada L',
        username: 'ada',
        about: 'hi there',
        participantsCount: undefined,
        verified: true,
      });
    });

    it('getFullChat maps a broadcast channel (count from ChannelFull)', async () => {
      const channel = asEntity(Api.Channel, {
        id: bigInt('77'),
        title: 'News',
        username: 'news',
        verified: true,
        megagroup: undefined,
      });
      const mock = createMockClient({
        getEntity: jest.fn().mockResolvedValue(channel),
        invoke: jest.fn().mockResolvedValue({
          fullChat: asEntity(Api.ChannelFull, {
            about: 'breaking',
            participantsCount: 1200,
          }),
        }),
      });
      await expect(createAdapter(mock).getFullChat('@news')).resolves.toEqual({
        id: '77',
        type: 'channel',
        title: 'News',
        username: 'news',
        about: 'breaking',
        participantsCount: 1200,
        verified: true,
      });
    });

    it('getFullChat treats a megagroup channel as a group', async () => {
      const supergroup = asEntity(Api.Channel, {
        id: bigInt('88'),
        title: 'Devs',
        megagroup: true,
      });
      const mock = createMockClient({
        getEntity: jest.fn().mockResolvedValue(supergroup),
        invoke: jest.fn().mockResolvedValue({
          fullChat: asEntity(Api.ChannelFull, { about: '', participantsCount: 5 }),
        }),
      });
      const info = await createAdapter(mock).getFullChat('@devs');
      expect(info.type).toBe('group');
      expect(info.participantsCount).toBe(5);
    });

    it('getFullChat tolerates a non-ChannelFull result (no count)', async () => {
      const channel = asEntity(Api.Channel, { id: bigInt('90'), title: 'C' });
      const mock = createMockClient({
        getEntity: jest.fn().mockResolvedValue(channel),
        invoke: jest.fn().mockResolvedValue({ fullChat: { about: 'x' } }),
      });
      const info = await createAdapter(mock).getFullChat('@c');
      expect(info.participantsCount).toBeUndefined();
      expect(info.about).toBe('x');
    });

    it('getFullChat maps a basic group (count from the entity)', async () => {
      const chat = asEntity(Api.Chat, {
        id: bigInt('9'),
        title: 'Family',
        participantsCount: 4,
      });
      const mock = createMockClient({
        getEntity: jest.fn().mockResolvedValue(chat),
        invoke: jest.fn().mockResolvedValue({ fullChat: { about: 'kin' } }),
      });
      await expect(createAdapter(mock).getFullChat(9)).resolves.toEqual({
        id: '9',
        type: 'group',
        title: 'Family',
        username: undefined,
        about: 'kin',
        participantsCount: 4,
        verified: false,
      });
    });

    it('getFullChat throws TelegramClientError for an empty/forbidden peer', async () => {
      const mock = createMockClient({
        getEntity: jest
          .fn()
          .mockResolvedValue(new Api.UserEmpty({ id: bigInt('0') })),
      });
      const error = await createAdapter(mock)
        .getFullChat('me')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramClientError);
      expect((error as TelegramClientError).operation).toBe('getFullChat');
    });

    it('getFullChat wraps underlying failures without double-wrapping', async () => {
      const mock = createMockClient({
        getEntity: jest.fn().mockRejectedValue(new Error('rpc')),
      });
      await expect(
        createAdapter(mock).getFullChat('@x'),
      ).rejects.toBeInstanceOf(TelegramClientError);
    });
  });

  describe('message operations', () => {
    it('editMessage maps the edited message', async () => {
      const mock = createMockClient({
        editMessage: jest
          .fn()
          .mockResolvedValue(aRawMessage({ id: 12, message: 'edited' })),
      });
      const edited = await createAdapter(mock).editMessage('me', 12, 'edited');
      expect(edited).toMatchObject({ id: 12, text: 'edited' });
      expect(mock.editMessage).toHaveBeenCalledWith('me', {
        message: 12,
        text: 'edited',
      });
    });

    it('deleteMessages revokes by default and respects an explicit flag', async () => {
      const mock = createMockClient({
        deleteMessages: jest.fn().mockResolvedValue([]),
      });
      const adapter = createAdapter(mock);

      await adapter.deleteMessages('me', [1, 2]);
      expect(mock.deleteMessages).toHaveBeenCalledWith('me', [1, 2], {
        revoke: true,
      });

      await adapter.deleteMessages('me', [3], { revoke: false });
      expect(mock.deleteMessages).toHaveBeenLastCalledWith('me', [3], {
        revoke: false,
      });
    });

    it('forwardMessages maps the forwarded messages', async () => {
      const mock = createMockClient({
        forwardMessages: jest
          .fn()
          .mockResolvedValue([aRawMessage({ id: 21 }), aRawMessage({ id: 22 })]),
      });
      const forwarded = await createAdapter(mock).forwardMessages(
        '@to',
        '@from',
        [21, 22],
      );
      expect(forwarded.map((m) => m.id)).toEqual([21, 22]);
      expect(mock.forwardMessages).toHaveBeenCalledWith('@to', {
        messages: [21, 22],
        fromPeer: '@from',
      });
    });

    it('markAsRead delegates to the client', async () => {
      const mock = createMockClient({
        markAsRead: jest.fn().mockResolvedValue(true),
      });
      await createAdapter(mock).markAsRead('@g');
      expect(mock.markAsRead).toHaveBeenCalledWith('@g');
    });

    it('pinMessage forwards notify (default false)', async () => {
      const mock = createMockClient({
        pinMessage: jest.fn().mockResolvedValue(undefined),
      });
      const adapter = createAdapter(mock);

      await adapter.pinMessage('me', 7);
      expect(mock.pinMessage).toHaveBeenCalledWith('me', 7, { notify: false });

      await adapter.pinMessage('me', 8, { notify: true });
      expect(mock.pinMessage).toHaveBeenLastCalledWith('me', 8, { notify: true });
    });

    it.each([
      [
        'joinChannel',
        'invoke',
        (a: GramJsClientAdapter): Promise<unknown> => a.joinChannel('@x'),
      ],
      [
        'leaveChannel',
        'invoke',
        (a: GramJsClientAdapter): Promise<unknown> => a.leaveChannel('@x'),
      ],
      [
        'getParticipants',
        'getParticipants',
        (a: GramJsClientAdapter): Promise<unknown> => a.getParticipants('@x'),
      ],
      [
        'searchMessages',
        'getMessages',
        (a: GramJsClientAdapter): Promise<unknown> => a.searchMessages('@x', 'q'),
      ],
      [
        'editMessage',
        'editMessage',
        (a: GramJsClientAdapter): Promise<unknown> => a.editMessage('me', 1, 't'),
      ],
      [
        'deleteMessages',
        'deleteMessages',
        (a: GramJsClientAdapter): Promise<unknown> => a.deleteMessages('me', [1]),
      ],
      [
        'forwardMessages',
        'forwardMessages',
        (a: GramJsClientAdapter): Promise<unknown> =>
          a.forwardMessages('a', 'b', [1]),
      ],
      [
        'markAsRead',
        'markAsRead',
        (a: GramJsClientAdapter): Promise<unknown> => a.markAsRead('me'),
      ],
      [
        'pinMessage',
        'pinMessage',
        (a: GramJsClientAdapter): Promise<unknown> => a.pinMessage('me', 1),
      ],
    ])(
      'wraps %s failures in TelegramClientError',
      async (_method, underlying, call) => {
        const mock = createMockClient({
          [underlying]: jest.fn().mockRejectedValue(new Error('rpc')),
        } as Partial<MockClient>);
        await expect(call(createAdapter(mock))).rejects.toBeInstanceOf(
          TelegramClientError,
        );
      },
    );
  });

  describe('media streaming', () => {
    describe('getMediaInfo', () => {
      it('maps a video document', async () => {
        const media = documentMedia({}, [
          asEntity(Api.DocumentAttributeVideo, {
            duration: 12,
            w: 1280,
            h: 720,
            supportsStreaming: true,
          }),
          asEntity(Api.DocumentAttributeFilename, { fileName: 'clip.mp4' }),
        ]);
        const mock = createMockClient({
          getMessages: jest.fn().mockResolvedValue([aRawMessage({ media })]),
        });

        await expect(createAdapter(mock).getMediaInfo('me', 1)).resolves.toEqual(
          {
            kind: 'video',
            mimeType: 'video/mp4',
            size: 1_048_576,
            fileName: 'clip.mp4',
            durationSeconds: 12,
            width: 1280,
            height: 720,
            supportsStreaming: true,
          },
        );
      });

      it('classifies a voice note vs. music by the audio attribute', async () => {
        const voice = documentMedia({ mimeType: 'audio/ogg' }, [
          asEntity(Api.DocumentAttributeAudio, { voice: true, duration: 5 }),
        ]);
        const music = documentMedia({ mimeType: 'audio/mpeg' }, [
          asEntity(Api.DocumentAttributeAudio, { duration: 200 }),
        ]);

        const voiceInfo = await createAdapter(
          createMockClient({
            getMessages: jest.fn().mockResolvedValue([aRawMessage({ media: voice })]),
          }),
        ).getMediaInfo('me', 1);
        const musicInfo = await createAdapter(
          createMockClient({
            getMessages: jest.fn().mockResolvedValue([aRawMessage({ media: music })]),
          }),
        ).getMediaInfo('me', 1);

        expect(voiceInfo?.kind).toBe('voice');
        expect(voiceInfo?.durationSeconds).toBe(5);
        expect(musicInfo?.kind).toBe('audio');
      });

      it('falls back to "document" with no media attributes', async () => {
        const media = documentMedia({ mimeType: 'application/pdf' }, [
          asEntity(Api.DocumentAttributeFilename, { fileName: 'report.pdf' }),
        ]);
        const mock = createMockClient({
          getMessages: jest.fn().mockResolvedValue([aRawMessage({ media })]),
        });
        const info = await createAdapter(mock).getMediaInfo('me', 1);
        expect(info?.kind).toBe('document');
        expect(info?.fileName).toBe('report.pdf');
      });

      it('reports a photo by kind only', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([
              aRawMessage({ media: asEntity(Api.MessageMediaPhoto, {}) }),
            ]),
        });
        await expect(createAdapter(mock).getMediaInfo('me', 1)).resolves.toEqual({
          kind: 'photo',
          mimeType: 'image/jpeg',
        });
      });

      it('returns undefined when the message has no media', async () => {
        const mock = createMockClient({
          getMessages: jest.fn().mockResolvedValue([aRawMessage()]),
        });
        await expect(
          createAdapter(mock).getMediaInfo('me', 1),
        ).resolves.toBeUndefined();
      });

      it('returns undefined for a document with no body', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([
              aRawMessage({ media: asEntity(Api.MessageMediaDocument, {}) }),
            ]),
        });
        await expect(
          createAdapter(mock).getMediaInfo('me', 1),
        ).resolves.toBeUndefined();
      });

      it('wraps failures in TelegramClientError', async () => {
        const mock = createMockClient({
          getMessages: jest.fn().mockRejectedValue(new Error('rpc')),
        });
        await expect(
          createAdapter(mock).getMediaInfo('me', 1),
        ).rejects.toBeInstanceOf(TelegramClientError);
      });
    });

    describe('downloadMediaRange', () => {
      it('returns exactly the requested bytes (offset 0)', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() => asyncChunks(Buffer.from('0123456789'))),
        });
        await expect(
          createAdapter(mock).downloadMediaRange('me', 1, { offset: 2, limit: 3 }),
        ).resolves.toEqual(Buffer.from('234'));
      });

      it('aligns the offset down to 4096 and slices the surplus', async () => {
        const chunk = Buffer.alloc(2000, 7);
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest.fn().mockImplementation(() => asyncChunks(chunk)),
        });

        const result = await createAdapter(mock).downloadMediaRange('me', 1, {
          offset: 5000,
          limit: 100,
        });

        // 5000 → aligned 4096; iterDownload must be asked for the aligned offset.
        const arg = mock.iterDownload.mock.calls[0]?.[0] as {
          offset: { toJSNumber(): number };
        };
        expect(arg.offset.toJSNumber()).toBe(4096);
        // skip = 5000 - 4096 = 904
        expect(result).toEqual(chunk.subarray(904, 1004));
        expect(result?.length).toBe(100);
      });

      it('sizes the request to the range (small probe vs. large read)', async () => {
        const small = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() => asyncChunks(Buffer.alloc(4096))),
        });
        await createAdapter(small).downloadMediaRange('me', 1, {
          offset: 0,
          limit: 2,
        });
        expect(
          (small.iterDownload.mock.calls[0]?.[0] as { requestSize: number })
            .requestSize,
        ).toBe(4096);

        const large = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() => asyncChunks(Buffer.alloc(600_000))),
        });
        await createAdapter(large).downloadMediaRange('me', 1, {
          offset: 0,
          limit: 600_000,
        });
        expect(
          (large.iterDownload.mock.calls[0]?.[0] as { requestSize: number })
            .requestSize,
        ).toBe(512 * 1024);
      });

      it('returns fewer bytes than requested at end-of-file', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() => asyncChunks(Buffer.from('ab'))),
        });
        await expect(
          createAdapter(mock).downloadMediaRange('me', 1, { offset: 0, limit: 10 }),
        ).resolves.toEqual(Buffer.from('ab'));
      });

      it('returns undefined when the message has no media', async () => {
        const mock = createMockClient({
          getMessages: jest.fn().mockResolvedValue([aRawMessage()]),
        });
        await expect(
          createAdapter(mock).downloadMediaRange('me', 1, { offset: 0, limit: 4 }),
        ).resolves.toBeUndefined();
      });

      it('wraps transport failures in TelegramClientError', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest.fn().mockImplementation(() =>
            (async function* () {
              throw new Error('rpc');
            })(),
          ),
        });
        await expect(
          createAdapter(mock).downloadMediaRange('me', 1, { offset: 0, limit: 4 }),
        ).rejects.toBeInstanceOf(TelegramClientError);
      });
    });

    describe('streamMedia', () => {
      it('yields the media chunks in order', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() =>
              asyncChunks(Buffer.from('hello'), Buffer.from('world')),
            ),
        });
        const chunks: Buffer[] = [];
        for await (const chunk of await createAdapter(mock).streamMedia('me', 1))
          chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from('helloworld'));
      });

      it('trims the leading surplus and honours the byte limit', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() => asyncChunks(Buffer.from('helloworld'))),
        });
        const chunks: Buffer[] = [];
        for await (const chunk of await createAdapter(mock).streamMedia('me', 1, {
          offset: 2,
          limit: 4,
        }))
          chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from('llow'));
      });

      it('applies the byte limit across multiple chunks', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() =>
              asyncChunks(Buffer.from('ab'), Buffer.from('cdef')),
            ),
        });
        const chunks: Buffer[] = [];
        // limit 5 over 'ab' + 'cdef': first whole chunk, then 3 of the next.
        for await (const chunk of await createAdapter(mock).streamMedia('me', 1, {
          limit: 5,
        }))
          chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from('abcde'));
      });

      it('skips across chunk boundaries', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest
            .fn()
            .mockImplementation(() =>
              asyncChunks(Buffer.from('a'), Buffer.from('bcdef')),
            ),
        });
        const chunks: Buffer[] = [];
        // offset 2 (skip 2): drop 'a', then drop one more from 'bcdef' → 'cdef'.
        for await (const chunk of await createAdapter(mock).streamMedia('me', 1, {
          offset: 2,
        }))
          chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(Buffer.from('cdef'));
      });

      it('throws when the message has no media', async () => {
        const mock = createMockClient({
          getMessages: jest.fn().mockResolvedValue([aRawMessage()]),
        });
        await expect(
          createAdapter(mock).streamMedia('me', 1),
        ).rejects.toBeInstanceOf(TelegramClientError);
      });

      it('wraps a message-fetch failure in TelegramClientError', async () => {
        const mock = createMockClient({
          getMessages: jest.fn().mockRejectedValue(new Error('rpc')),
        });
        await expect(
          createAdapter(mock).streamMedia('me', 1),
        ).rejects.toBeInstanceOf(TelegramClientError);
      });

      it('wraps a transport failure that surfaces mid-stream', async () => {
        const mock = createMockClient({
          getMessages: jest
            .fn()
            .mockResolvedValue([aRawMessage({ media: documentMedia() })]),
          iterDownload: jest.fn().mockImplementation(() =>
            (async function* () {
              throw new Error('boom');
            })(),
          ),
        });
        const stream = await createAdapter(mock).streamMedia('me', 1);
        const drain = async (): Promise<void> => {
          const out: Buffer[] = [];
          for await (const chunk of stream) out.push(chunk);
        };
        await expect(drain()).rejects.toBeInstanceOf(TelegramClientError);
      });
    });
  });
});
