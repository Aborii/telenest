/**
 * @file src/lib/client/telegram-client.lifecycle.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the MTProto connection is closed when the module is destroyed.
 */

import type { IGramClient } from './gram-client.interface';
import { TelegramClientLifecycle } from './telegram-client.lifecycle';

/** Builds a fake client whose disconnect is observable. */
function fakeClient(): IGramClient {
  return {
    connect: jest.fn(),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn(),
    sendCode: jest.fn(),
    signInWithCode: jest.fn(),
    signInWithPassword: jest.fn(),
    logOut: jest.fn(),
    getMe: jest.fn(),
    getDialogs: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    sendFile: jest.fn(),
    downloadMedia: jest.fn(),
    downloadProfilePhoto: jest.fn(),
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
  };
}

describe('TelegramClientLifecycle', () => {
  it('disconnects the client on module destroy', async () => {
    const client = fakeClient();
    const lifecycle = new TelegramClientLifecycle(client);

    await lifecycle.onModuleDestroy();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
