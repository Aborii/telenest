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
// ── big-integer uses `export =` (CommonJS); the project omits esModuleInterop,
//    so the import-equals form is required for the call to resolve at runtime. ─
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see note above: `export =` interop requires the import-equals form.
import bigInt = require('big-integer');
import { TelegramAuthError, TelegramClientError } from '../common';
import {
  createGramJsClient,
  GramJsClientAdapter,
} from './gramjs-client.adapter';

/** Minimal mock of the GramJS client surface the adapter calls. */
type MockClient = {
  connect: jest.Mock;
  disconnect: jest.Mock;
  checkAuthorization: jest.Mock;
  sendCode: jest.Mock;
  invoke: jest.Mock;
  getMe: jest.Mock;
  getDialogs: jest.Mock;
  getMessages: jest.Mock;
  sendMessage: jest.Mock;
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
    invoke: jest.fn(),
    getMe: jest.fn(),
    getDialogs: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    addEventHandler: jest.fn(),
    removeEventHandler: jest.fn(),
    ...overrides,
  };
}

/** Wraps a mock client in a freshly-constructed adapter. */
function createAdapter(mock: MockClient): GramJsClientAdapter {
  return new GramJsClientAdapter(
    mock as unknown as TelegramClient,
    new sessions.StringSession(''),
    { apiId: 1, apiHash: 'hash' },
  );
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
});
