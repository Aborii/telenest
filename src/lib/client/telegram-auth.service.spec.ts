/**
 * @file src/lib/client/telegram-auth.service.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the sign-in state machine. A fake {@link IGramClient} and a
 * fake {@link SessionStore} make every branch deterministic and network-free.
 */

import { Logger } from '@nestjs/common';

import { TelegramAuthError } from '../common';
import type { IGramClient } from './gram-client.interface';
import type { GramQrToken, GramUser } from './gram-client.types';
import type { SessionStore } from './session/session-store.interface';
import { TelegramAuthService } from './telegram-auth.service';

/** A representative authenticated user DTO. */
const FAKE_USER: GramUser = {
  id: '1001',
  isSelf: true,
  isBot: false,
  isPremium: true,
  firstName: 'Ada',
  username: 'ada',
};

/** Builds a fully-mocked client with sensible defaults. */
function createFakeClient(
  overrides: Partial<IGramClient> = {},
): jest.Mocked<IGramClient> {
  const base: jest.Mocked<IGramClient> = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn().mockResolvedValue(false),
    sendCode: jest
      .fn()
      .mockResolvedValue({ phoneCodeHash: 'HASH', isCodeViaApp: true }),
    signInWithCode: jest
      .fn()
      .mockResolvedValue({ status: 'authorized', user: FAKE_USER }),
    signInWithPassword: jest.fn().mockResolvedValue(FAKE_USER),
    signInWithQrCode: jest.fn().mockResolvedValue(FAKE_USER),
    signInAsBot: jest.fn().mockResolvedValue(FAKE_USER),
    updateTwoFactor: jest.fn().mockResolvedValue(undefined),
    logOut: jest.fn().mockResolvedValue(undefined),
    getMe: jest.fn().mockResolvedValue(FAKE_USER),
    getDialogs: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn(),
    sendFile: jest.fn(),
    downloadMedia: jest.fn(),
    downloadProfilePhoto: jest.fn(),
    getMediaInfo: jest.fn(),
    downloadMediaRange: jest.fn(),
    streamMedia: jest.fn(),
    joinChannel: jest.fn(),
    leaveChannel: jest.fn(),
    getParticipants: jest.fn(),
    searchMessages: jest.fn(),
    getFullChat: jest.fn(),
    editMessage: jest.fn(),
    deleteMessages: jest.fn(),
    forwardMessages: jest.fn(),
    markAsRead: jest.fn(),
    pinMessage: jest.fn(),
    exportSession: jest.fn().mockReturnValue('SESSION-STRING'),
    onNewMessage: jest.fn().mockReturnValue(() => undefined),
    onEditedMessage: jest.fn().mockReturnValue(() => undefined),
    onDeletedMessages: jest.fn().mockReturnValue(() => undefined),
    onChatAction: jest.fn().mockReturnValue(() => undefined),
  } as jest.Mocked<IGramClient>;
  return Object.assign(base, overrides);
}

/** Builds a fully-mocked session store. */
function createFakeStore(): jest.Mocked<SessionStore> {
  return {
    load: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
}

describe('TelegramAuthService', () => {
  it('throws CODE_NOT_REQUESTED when signIn is called before sendCode', async () => {
    const client = createFakeClient();
    const service = new TelegramAuthService(client);

    const error = await service.signIn('12345').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramAuthError);
    expect((error as TelegramAuthError).code).toBe('CODE_NOT_REQUESTED');
    expect(client.signInWithCode).not.toHaveBeenCalled();
  });

  it('sendCode stores the phone code hash and returns the result', async () => {
    const client = createFakeClient();
    const service = new TelegramAuthService(client);

    const result = await service.sendCode('+15551234567');

    expect(client.sendCode).toHaveBeenCalledWith('+15551234567', false);
    expect(result.phoneCodeHash).toBe('HASH');
  });

  it('signIn completes (no 2FA) and persists the session', async () => {
    const client = createFakeClient();
    const store = createFakeStore();
    const service = new TelegramAuthService(client, store);

    await service.sendCode('+15551234567');
    const step = await service.signIn('12345');

    expect(step.status).toBe('authorized');
    expect(client.signInWithCode).toHaveBeenCalledWith({
      phoneNumber: '+15551234567',
      phoneCodeHash: 'HASH',
      phoneCode: '12345',
    });
    expect(store.save).toHaveBeenCalledWith('SESSION-STRING');
  });

  it('signIn surfaces the password-required step without persisting', async () => {
    const client = createFakeClient({
      signInWithCode: jest
        .fn()
        .mockResolvedValue({ status: 'password-required' }),
    });
    const store = createFakeStore();
    const service = new TelegramAuthService(client, store);

    await service.sendCode('+15551234567');
    const step = await service.signIn('12345');

    expect(step.status).toBe('password-required');
    expect(store.save).not.toHaveBeenCalled();
  });

  it('checkPassword completes 2FA and persists the session', async () => {
    const client = createFakeClient();
    const store = createFakeStore();
    const service = new TelegramAuthService(client, store);

    const user = await service.checkPassword('hunter2');

    expect(client.signInWithPassword).toHaveBeenCalledWith('hunter2');
    expect(user).toEqual(FAKE_USER);
    expect(store.save).toHaveBeenCalledWith('SESSION-STRING');
  });

  it('logOut clears the store and resets pending login state', async () => {
    const client = createFakeClient();
    const store = createFakeStore();
    const service = new TelegramAuthService(client, store);

    await service.sendCode('+15551234567');
    await service.logOut();

    expect(client.logOut).toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalled();

    // ── State was reset: a subsequent signIn must require sendCode again. ────
    const error = await service.signIn('12345').catch((e: unknown) => e);
    expect((error as TelegramAuthError).code).toBe('CODE_NOT_REQUESTED');
  });

  it('persistSession is a no-op without a store', async () => {
    const client = createFakeClient();
    const service = new TelegramAuthService(client);

    await service.sendCode('+15551234567');
    await expect(service.signIn('12345')).resolves.toMatchObject({
      status: 'authorized',
    });
  });

  it('connects lazily before operations when disconnected', async () => {
    const client = createFakeClient({
      isConnected: jest.fn().mockReturnValue(false),
    });
    const service = new TelegramAuthService(client);

    await service.isAuthorized();

    expect(client.connect).toHaveBeenCalled();
    expect(client.isAuthorized).toHaveBeenCalled();
  });

  it('exportSession delegates to the client', () => {
    const client = createFakeClient();
    const service = new TelegramAuthService(client);
    expect(service.exportSession()).toBe('SESSION-STRING');
  });

  it('logOut without a configured store resets state and calls client.logOut', async () => {
    const client = createFakeClient();
    const service = new TelegramAuthService(client); // no store

    await service.sendCode('+15551234567');
    await service.logOut();

    expect(client.logOut).toHaveBeenCalled();
    const error = await service.signIn('123').catch((e: unknown) => e);
    expect((error as TelegramAuthError).code).toBe('CODE_NOT_REQUESTED');
  });

  it('masks the phone number in logs (never logs it in full)', async () => {
    const client = createFakeClient();
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const service = new TelegramAuthService(client);

    await service.sendCode('+15551234567');

    const logged = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).not.toContain('+15551234567');
    expect(logged).toContain('+1');
    expect(logged).toContain('67');

    logSpy.mockRestore();
  });

  it('masks a short phone-like input entirely', async () => {
    const client = createFakeClient();
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const service = new TelegramAuthService(client);

    await service.sendCode('1234');

    const logged = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('****');
    expect(logged).not.toContain('1234');

    logSpy.mockRestore();
  });

  describe('signInWithQrCode', () => {
    it('streams the QR token, resolves the user, and persists the session', async () => {
      const token: GramQrToken = {
        token: 'TOK',
        url: 'tg://login?token=TOK',
        expires: 99,
      };
      const client = createFakeClient({
        signInWithQrCode: jest.fn().mockImplementation(async (cb) => {
          cb.onToken(token);
          return FAKE_USER;
        }),
      });
      const store = createFakeStore();
      const service = new TelegramAuthService(client, store);

      const tokens: GramQrToken[] = [];
      const { qr$, completed } = service.signInWithQrCode();
      qr$.subscribe((t) => tokens.push(t));

      const user = await completed;

      expect(user).toEqual(FAKE_USER);
      expect(tokens).toEqual([token]);
      expect(store.save).toHaveBeenCalledWith('SESSION-STRING');
    });

    it('forwards the onPassword callback to the client', async () => {
      const onPassword = jest.fn().mockResolvedValue('pw');
      const client = createFakeClient();
      const service = new TelegramAuthService(client);

      await service.signInWithQrCode({ onPassword }).completed;

      expect(client.signInWithQrCode).toHaveBeenCalledWith(
        expect.objectContaining({ onPassword }),
      );
    });

    it('completes the token stream and rejects completed on failure (no persist)', async () => {
      const client = createFakeClient({
        signInWithQrCode: jest
          .fn()
          .mockRejectedValue(new TelegramAuthError('PASSWORD_REQUIRED', 'x')),
      });
      const store = createFakeStore();
      const service = new TelegramAuthService(client, store);

      let streamCompleted = false;
      const { qr$, completed } = service.signInWithQrCode();
      qr$.subscribe({ complete: () => (streamCompleted = true) });

      const error = await completed.catch((e: unknown) => e);

      expect((error as TelegramAuthError).code).toBe('PASSWORD_REQUIRED');
      expect(streamCompleted).toBe(true);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('connects lazily before the QR flow when disconnected', async () => {
      const client = createFakeClient({
        isConnected: jest.fn().mockReturnValue(false),
      });
      const service = new TelegramAuthService(client);

      await service.signInWithQrCode().completed;

      expect(client.connect).toHaveBeenCalled();
    });
  });

  describe('signInAsBot', () => {
    it('signs in, persists the session, and never logs the token', async () => {
      const client = createFakeClient();
      const store = createFakeStore();
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const service = new TelegramAuthService(client, store);

      const user = await service.signInAsBot('123456:SECRET-TOKEN');

      expect(client.signInAsBot).toHaveBeenCalledWith('123456:SECRET-TOKEN');
      expect(user).toEqual(FAKE_USER);
      expect(store.save).toHaveBeenCalledWith('SESSION-STRING');

      const logged = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
      expect(logged).not.toContain('SECRET-TOKEN');

      logSpy.mockRestore();
    });
  });

  describe('two-factor management', () => {
    it('setupTwoFactor enables a new password with the hint', async () => {
      const client = createFakeClient();
      const service = new TelegramAuthService(client);

      await service.setupTwoFactor({ password: 'pw', hint: 'usual' });

      expect(client.updateTwoFactor).toHaveBeenCalledWith({
        newPassword: 'pw',
        hint: 'usual',
      });
    });

    it('changeTwoFactor passes current + new password', async () => {
      const client = createFakeClient();
      const service = new TelegramAuthService(client);

      await service.changeTwoFactor({
        currentPassword: 'old',
        newPassword: 'new',
      });

      expect(client.updateTwoFactor).toHaveBeenCalledWith({
        currentPassword: 'old',
        newPassword: 'new',
        hint: undefined,
      });
    });

    it('disableTwoFactor removes the password (no newPassword)', async () => {
      const client = createFakeClient();
      const service = new TelegramAuthService(client);

      await service.disableTwoFactor('old');

      expect(client.updateTwoFactor).toHaveBeenCalledWith({
        currentPassword: 'old',
      });
    });

    it('connects lazily before a 2FA update when disconnected', async () => {
      const client = createFakeClient({
        isConnected: jest.fn().mockReturnValue(false),
      });
      const service = new TelegramAuthService(client);

      await service.setupTwoFactor({ password: 'pw' });

      expect(client.connect).toHaveBeenCalled();
    });
  });
});
