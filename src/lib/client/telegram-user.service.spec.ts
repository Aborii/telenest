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
    signInWithQrCode: jest.fn(),
    signInAsBot: jest.fn(),
    updateTwoFactor: jest.fn(),
    logOut: jest.fn(),
    getMe: jest.fn().mockResolvedValue(FAKE_USER),
    getDialogs: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(FAKE_MESSAGE),
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
    expect(client.getDialogs).toHaveBeenCalledWith({
      limit: 10,
      archived: true,
    });
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
    await service.sendMessage('@x', {
      message: '<b>hi</b>',
      parseMode: 'html',
    });
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

  describe('extended user operations', () => {
    it('sendFile forwards peer and params', async () => {
      const client = createFakeClient();
      const params = { file: 'a.png', caption: 'c', asPhoto: true };
      await new TelegramUserService(client).sendFile('@x', params);
      expect(client.sendFile).toHaveBeenCalledWith('@x', params);
    });

    it('downloadMedia forwards peer and message id', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).downloadMedia('@x', 7);
      expect(client.downloadMedia).toHaveBeenCalledWith('@x', 7);
    });

    it('downloadProfilePhoto forwards the peer', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).downloadProfilePhoto('me');
      expect(client.downloadProfilePhoto).toHaveBeenCalledWith('me');
    });

    it('getMediaInfo forwards peer and message id', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).getMediaInfo('@x', 7);
      expect(client.getMediaInfo).toHaveBeenCalledWith('@x', 7);
    });

    it('downloadMediaRange forwards peer, id and range', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).downloadMediaRange('@x', 7, {
        offset: 100,
        limit: 50,
      });
      expect(client.downloadMediaRange).toHaveBeenCalledWith('@x', 7, {
        offset: 100,
        limit: 50,
      });
    });

    it('streamMedia forwards peer, id and options', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).streamMedia('@x', 7, { offset: 8 });
      expect(client.streamMedia).toHaveBeenCalledWith('@x', 7, { offset: 8 });
    });

    it('joinChannel and leaveChannel forward the peer', async () => {
      const client = createFakeClient();
      const service = new TelegramUserService(client);
      await service.joinChannel('@c');
      await service.leaveChannel('@c');
      expect(client.joinChannel).toHaveBeenCalledWith('@c');
      expect(client.leaveChannel).toHaveBeenCalledWith('@c');
    });

    it('getParticipants forwards peer and params', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).getParticipants('@g', { limit: 2 });
      expect(client.getParticipants).toHaveBeenCalledWith('@g', { limit: 2 });
    });

    it('searchMessages forwards peer, query and params', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).searchMessages('@g', 'q', {
        limit: 4,
      });
      expect(client.searchMessages).toHaveBeenCalledWith('@g', 'q', {
        limit: 4,
      });
    });

    it('getFullChat forwards the peer', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).getFullChat('@g');
      expect(client.getFullChat).toHaveBeenCalledWith('@g');
    });

    it('editMessage forwards peer, id and text', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).editMessage('me', 5, 'new');
      expect(client.editMessage).toHaveBeenCalledWith('me', 5, 'new');
    });

    it('deleteMessages forwards peer, ids and params', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).deleteMessages('me', [1, 2], {
        revoke: false,
      });
      expect(client.deleteMessages).toHaveBeenCalledWith('me', [1, 2], {
        revoke: false,
      });
    });

    it('forwardMessages forwards destination, source and ids', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).forwardMessages('@to', '@from', [9]);
      expect(client.forwardMessages).toHaveBeenCalledWith('@to', '@from', [9]);
    });

    it('markAsRead forwards the peer', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).markAsRead('@g');
      expect(client.markAsRead).toHaveBeenCalledWith('@g');
    });

    it('pinMessage forwards peer, id and params', async () => {
      const client = createFakeClient();
      await new TelegramUserService(client).pinMessage('me', 3, {
        notify: true,
      });
      expect(client.pinMessage).toHaveBeenCalledWith('me', 3, { notify: true });
    });

    it('lazily connects before an extended operation', async () => {
      const client = createFakeClient({
        isConnected: jest.fn().mockReturnValue(false),
      });
      await new TelegramUserService(client).joinChannel('@c');
      expect(client.connect).toHaveBeenCalledTimes(1);
    });
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
