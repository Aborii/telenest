/**
 * @file src/lib/client/telegram-user.service.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the user-account operations facade against a fake client.
 */

import type { IGramClient } from './gram-client.interface';
import {
  GRAM_CHAT_ACTIONS,
  type GramChatActionEvent,
  type GramDeletedMessages,
  type GramMessage,
  type GramUser,
} from './gram-client.types';
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
    onEditedMessage: jest.fn().mockReturnValue(() => undefined),
    onDeletedMessages: jest.fn().mockReturnValue(() => undefined),
    onChatAction: jest.fn().mockReturnValue(() => undefined),
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

    it('unsubscribes and completes every stream on destroy', () => {
      const unsubscribers = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
      const client = createFakeClient({
        onNewMessage: jest.fn().mockReturnValue(unsubscribers[0]),
        onEditedMessage: jest.fn().mockReturnValue(unsubscribers[1]),
        onDeletedMessages: jest.fn().mockReturnValue(unsubscribers[2]),
        onChatAction: jest.fn().mockReturnValue(unsubscribers[3]),
      });
      const service = new TelegramUserService(client);

      const completed = { updates: false, edited: false, deleted: false, actions: false };
      service.updates$.subscribe({ complete: () => (completed.updates = true) });
      service.editedMessages$.subscribe({ complete: () => (completed.edited = true) });
      service.deletedMessages$.subscribe({ complete: () => (completed.deleted = true) });
      service.chatActions$.subscribe({ complete: () => (completed.actions = true) });

      service.onModuleInit();
      service.onModuleDestroy();

      for (const unsubscribe of unsubscribers)
        expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(completed).toEqual({
        updates: true,
        edited: true,
        deleted: true,
        actions: true,
      });
    });
  });

  describe('edited / deleted / chat-action streams', () => {
    it('forwards edited messages to editedMessages$', () => {
      let emit: ((m: GramMessage) => void) | undefined;
      const client = createFakeClient({
        onEditedMessage: jest.fn((h: (m: GramMessage) => void) => {
          emit = h;
          return () => undefined;
        }),
      });
      const service = new TelegramUserService(client);
      const received: GramMessage[] = [];
      service.editedMessages$.subscribe((m) => received.push(m));

      service.onModuleInit();
      emit?.({ ...FAKE_MESSAGE, text: 'edited' });

      expect(received).toEqual([{ ...FAKE_MESSAGE, text: 'edited' }]);
    });

    it('forwards deletion events to deletedMessages$', () => {
      let emit: ((e: GramDeletedMessages) => void) | undefined;
      const client = createFakeClient({
        onDeletedMessages: jest.fn((h: (e: GramDeletedMessages) => void) => {
          emit = h;
          return () => undefined;
        }),
      });
      const service = new TelegramUserService(client);
      const received: GramDeletedMessages[] = [];
      service.deletedMessages$.subscribe((e) => received.push(e));

      service.onModuleInit();
      emit?.({ messageIds: [1, 2], peerId: '999' });

      expect(received).toEqual([{ messageIds: [1, 2], peerId: '999' }]);
    });

    it('forwards chat actions to chatActions$', () => {
      let emit: ((e: GramChatActionEvent) => void) | undefined;
      const client = createFakeClient({
        onChatAction: jest.fn((h: (e: GramChatActionEvent) => void) => {
          emit = h;
          return () => undefined;
        }),
      });
      const service = new TelegramUserService(client);
      const received: GramChatActionEvent[] = [];
      service.chatActions$.subscribe((e) => received.push(e));

      service.onModuleInit();
      const event: GramChatActionEvent = {
        peerId: '7',
        userId: '7',
        action: GRAM_CHAT_ACTIONS.TYPING,
      };
      emit?.(event);

      expect(received).toEqual([event]);
    });
  });

  describe('catch-up (replay) buffer', () => {
    /** Wires a fake whose new-message emit handle the test captures. */
    function emittableClient(): {
      client: jest.Mocked<IGramClient>;
      emit: (m: GramMessage) => void;
    } {
      let emit: ((m: GramMessage) => void) | undefined;
      const client = createFakeClient({
        onNewMessage: jest.fn((h: (m: GramMessage) => void) => {
          emit = h;
          return () => undefined;
        }),
      });
      return { client, emit: (m) => emit?.(m) };
    }

    it('replays recent events to a late subscriber when configured', () => {
      const { client, emit } = emittableClient();
      const service = new TelegramUserService(client, undefined, 2);

      service.onModuleInit();
      emit({ ...FAKE_MESSAGE, id: 1 });
      emit({ ...FAKE_MESSAGE, id: 2 });
      emit({ ...FAKE_MESSAGE, id: 3 });

      // ── Subscriber added AFTER the emissions still sees the last 2. ──────────
      const received: number[] = [];
      service.updates$.subscribe((m) => received.push(m.id));
      expect(received).toEqual([2, 3]);
    });

    it('does not replay to a late subscriber by default (hot stream)', () => {
      const { client, emit } = emittableClient();
      const service = new TelegramUserService(client);

      service.onModuleInit();
      emit({ ...FAKE_MESSAGE, id: 1 });

      const received: number[] = [];
      service.updates$.subscribe((m) => received.push(m.id));
      expect(received).toEqual([]);
    });

    it('treats a non-positive buffer size as no replay', () => {
      const { client, emit } = emittableClient();
      const service = new TelegramUserService(client, undefined, -5);

      service.onModuleInit();
      emit({ ...FAKE_MESSAGE, id: 1 });

      const received: number[] = [];
      service.updates$.subscribe((m) => received.push(m.id));
      expect(received).toEqual([]);
    });
  });
});
