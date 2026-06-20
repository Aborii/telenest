/**
 * @file src/lib/client/telegram-client.factory.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the MTProto DI providers: session-source precedence, the
 * `clientFactory` test seam, eager-vs-lazy connect, and the non-fatal handling
 * of a connect failure during bootstrap.
 */

import type { FactoryProvider } from '@nestjs/common';
import type { IGramClient } from './gram-client.interface';
import {
  gramClientProvider,
  sessionStoreProvider,
} from './telegram-client.factory';
import type { TelegramClientModuleOptions } from './telegram-client.options';
import type { SessionStore } from './session/session-store.interface';

/** Invokes the gram-client provider factory with explicit args. */
const buildClient = (
  options: TelegramClientModuleOptions,
  store?: SessionStore,
): Promise<IGramClient> => {
  const factory = (gramClientProvider as FactoryProvider).useFactory as (
    o: TelegramClientModuleOptions,
    s?: SessionStore,
  ) => Promise<IGramClient>;
  return factory(options, store);
};

/** Builds a fake client whose `connect` is observable. */
function fakeClient(connect = jest.fn().mockResolvedValue(undefined)): IGramClient {
  return {
    connect,
    disconnect: jest.fn(),
    isConnected: jest.fn().mockReturnValue(false),
    isAuthorized: jest.fn(),
    sendCode: jest.fn(),
    signInWithCode: jest.fn(),
    signInWithPassword: jest.fn(),
    logOut: jest.fn(),
    getMe: jest.fn(),
    getDialogs: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    exportSession: jest.fn().mockReturnValue(''),
    onNewMessage: jest.fn().mockReturnValue(() => undefined),
  };
}

describe('gramClientProvider', () => {
  it('uses the clientFactory seam and connects eagerly by default', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const fake = fakeClient(connect);
    const clientFactory = jest.fn().mockReturnValue(fake);

    const client = await buildClient({ apiId: 1, apiHash: 'h', clientFactory });

    expect(client).toBe(fake);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('skips connect when autoConnect is false', async () => {
    const connect = jest.fn();
    const fake = fakeClient(connect);
    await buildClient({
      apiId: 1,
      apiHash: 'h',
      autoConnect: false,
      clientFactory: () => fake,
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('prefers options.session over the store, and falls back to the store', async () => {
    const sessions: string[] = [];
    const clientFactory = jest.fn((_, session: string) => {
      sessions.push(session);
      return fakeClient();
    });
    const store: SessionStore = {
      load: jest.fn().mockResolvedValue('FROM-STORE'),
      save: jest.fn(),
      clear: jest.fn(),
    };

    await buildClient(
      { apiId: 1, apiHash: 'h', autoConnect: false, session: 'FROM-OPTIONS', clientFactory },
      store,
    );
    await buildClient(
      { apiId: 1, apiHash: 'h', autoConnect: false, clientFactory },
      store,
    );

    expect(sessions).toEqual(['FROM-OPTIONS', 'FROM-STORE']);
  });

  it('does not throw when eager connect fails (logged, not fatal)', async () => {
    const fake = fakeClient(jest.fn().mockRejectedValue(new Error('no net')));
    await expect(
      buildClient({ apiId: 1, apiHash: 'h', clientFactory: () => fake }),
    ).resolves.toBe(fake);
  });
});

describe('sessionStoreProvider', () => {
  it('exposes the configured store', () => {
    const store: SessionStore = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
    const factory = (sessionStoreProvider as FactoryProvider).useFactory as (
      o: TelegramClientModuleOptions,
    ) => SessionStore | undefined;
    expect(factory({ apiId: 1, apiHash: 'h', sessionStore: store })).toBe(store);
  });

  it('returns undefined when no store is configured', () => {
    const factory = (sessionStoreProvider as FactoryProvider).useFactory as (
      o: TelegramClientModuleOptions,
    ) => SessionStore | undefined;
    expect(factory({ apiId: 1, apiHash: 'h' })).toBeUndefined();
  });
});
