/**
 * @file src/lib/client/telegram-user.service.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the user-account operations facade against a fake client.
 */

import type { IGramClient } from './gram-client.interface';
import type { GramMessage, GramUser } from './gram-client.types';
import { TelegramUserService } from './telegram-user.service';

/** A representative user DTO. */
const FAKE_USER: GramUser = {
  id: '1001',
  isSelf: true,
  isBot: false,
  isPremium: false,
};

/** A representative message DTO returned by the fake client. */
const FAKE_MESSAGE: GramMessage = {
  id: 5,
  peerId: '1001',
  text: 'hi',
  date: 1700000000,
  out: true,
};

/** Builds a fully-mocked client. */
function createFakeClient(
  overrides: Partial<IGramClient> = {},
): jest.Mocked<IGramClient> {
  const base: jest.Mocked<IGramClient> = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn().mockResolvedValue(true),
    sendCode: jest.fn(),
    signInWithCode: jest.fn(),
    signInWithPassword: jest.fn(),
    logOut: jest.fn(),
    getMe: jest.fn().mockResolvedValue(FAKE_USER),
    getDialogs: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(FAKE_MESSAGE),
    exportSession: jest.fn().mockReturnValue(''),
    onNewMessage: jest.fn().mockReturnValue(() => undefined),
  } as jest.Mocked<IGramClient>;
  return Object.assign(base, overrides);
}

describe('TelegramUserService', () => {
  it('getMe delegates to the client', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await expect(service.getMe()).resolves.toEqual(FAKE_USER);
  });

  it('getDialogs forwards params', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await service.getDialogs({ limit: 10, archived: true });
    expect(client.getDialogs).toHaveBeenCalledWith({ limit: 10, archived: true });
  });

  it('getMessages forwards peer and params', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await service.getMessages('@channel', { limit: 5 });
    expect(client.getMessages).toHaveBeenCalledWith('@channel', { limit: 5 });
  });

  it('sendMessage wraps a bare string into { message }', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await service.sendMessage('me', 'hello');
    expect(client.sendMessage).toHaveBeenCalledWith('me', { message: 'hello' });
  });

  it('sendMessage passes a params object through unchanged', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await service.sendMessage('@x', { message: '<b>hi</b>', parseMode: 'html' });
    expect(client.sendMessage).toHaveBeenCalledWith('@x', {
      message: '<b>hi</b>',
      parseMode: 'html',
    });
  });

  it('sendToSelf targets the "me" peer', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await service.sendToSelf('note');
    expect(client.sendMessage).toHaveBeenCalledWith('me', { message: 'note' });
  });

  it('connects lazily when disconnected', async () => {
    const client = createFakeClient({
      isConnected: jest.fn().mockReturnValue(false),
    });
    const service = new TelegramUserService(client);
    await service.getMe();
    expect(client.connect).toHaveBeenCalled();
  });

  it('does not reconnect when already connected', async () => {
    const client = createFakeClient();
    const service = new TelegramUserService(client);
    await service.getMe();
    expect(client.connect).not.toHaveBeenCalled();
  });

  describe('updates$', () => {
    it('forwards client new-message events after onModuleInit', () => {
      let emit: ((message: GramMessage) => void) | undefined;
      const client = createFakeClient({
        onNewMessage: jest.fn((handler: (m: GramMessage) => void) => {
          emit = handler;
          return () => {
            emit = undefined;
          };
        }),
      });
      const service = new TelegramUserService(client);

      const received: GramMessage[] = [];
      service.updates$.subscribe((message) => received.push(message));

      service.onModuleInit();
      emit?.(FAKE_MESSAGE);

      expect(client.onNewMessage).toHaveBeenCalledTimes(1);
      expect(received).toEqual([FAKE_MESSAGE]);
    });

    it('unsubscribes and completes the stream on destroy', () => {
      const unsubscribe = jest.fn();
      const client = createFakeClient({
        onNewMessage: jest.fn().mockReturnValue(unsubscribe),
      });
      const service = new TelegramUserService(client);

      let completed = false;
      service.updates$.subscribe({ complete: () => (completed = true) });

      service.onModuleInit();
      service.onModuleDestroy();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(completed).toBe(true);
    });
  });
});
