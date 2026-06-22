/**
 * @file src/lib/testing/mock-gram-client.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the public MTProto test seam: that {@link createMockGramClient}
 * produces a fully-spied {@link IGramClient} with sensible defaults, honours
 * overrides, drops into a real service, and that {@link provideMockGramClient}
 * binds it to the {@link TELEGRAM_GRAM_CLIENT} token in a Nest `TestingModule`.
 */

import { Test } from '@nestjs/testing';
import type { IGramClient } from '../client/gram-client.interface';
import { TELEGRAM_GRAM_CLIENT } from '../client/telegram-client.constants';
import { TelegramUserService } from '../client/telegram-user.service';
import { aGramMessage, aGramUser } from './dto-builders';
import { createMockGramClient, provideMockGramClient } from './mock-gram-client';

/** Every method declared on {@link IGramClient}. */
const CLIENT_METHODS: ReadonlyArray<keyof IGramClient> = [
  'connect',
  'disconnect',
  'isConnected',
  'isAuthorized',
  'sendCode',
  'signInWithCode',
  'signInWithPassword',
  'logOut',
  'getMe',
  'getDialogs',
  'getMessages',
  'sendMessage',
  'exportSession',
  'onNewMessage',
];

describe('createMockGramClient', () => {
  it('exposes every IGramClient method as a jest spy', () => {
    const client = createMockGramClient();
    for (const method of CLIENT_METHODS)
      expect(jest.isMockFunction(client[method])).toBe(true);
  });

  it('defaults to a connected, authorized account with no traffic', async () => {
    const client = createMockGramClient();

    expect(client.isConnected()).toBe(true);
    await expect(client.isAuthorized()).resolves.toBe(true);
    await expect(client.connect()).resolves.toBeUndefined();
    await expect(client.disconnect()).resolves.toBeUndefined();
    await expect(client.logOut()).resolves.toBeUndefined();
    await expect(client.getMe()).resolves.toEqual(aGramUser());
    await expect(client.getDialogs()).resolves.toEqual([]);
    await expect(client.getMessages('me')).resolves.toEqual([]);
    await expect(client.sendMessage('me', { message: 'x' })).resolves.toEqual(
      aGramMessage(),
    );
    expect(client.exportSession()).toBe('TEST_SESSION');
  });

  it('defaults the auth flow to a completed sign-in', async () => {
    const client = createMockGramClient();

    await expect(client.sendCode('+15551234567')).resolves.toEqual({
      phoneCodeHash: 'TEST_HASH',
      isCodeViaApp: true,
    });
    await expect(
      client.signInWithCode({
        phoneNumber: '+15551234567',
        phoneCodeHash: 'TEST_HASH',
        phoneCode: '12345',
      }),
    ).resolves.toEqual({ status: 'authorized', user: aGramUser() });
    await expect(client.signInWithPassword('hunter2')).resolves.toEqual(
      aGramUser(),
    );
  });

  it('returns an unsubscribe function from onNewMessage', () => {
    const client = createMockGramClient();
    const unsubscribe = client.onNewMessage(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    expect(unsubscribe()).toBeUndefined();
  });

  it('lets a jest.fn() override replace a default', async () => {
    const client = createMockGramClient({
      getMe: jest.fn().mockResolvedValue(aGramUser({ username: 'overridden' })),
    });
    await expect(client.getMe()).resolves.toEqual(
      aGramUser({ username: 'overridden' }),
    );
  });

  it('accepts a plain function override (no jest.fn required)', async () => {
    const client = createMockGramClient({
      getMe: async () => aGramUser({ username: 'me' }),
    });
    await expect(client.getMe()).resolves.toEqual(aGramUser({ username: 'me' }));
  });

  it('drops into a real TelegramUserService (no network)', async () => {
    const client = createMockGramClient();
    const service = new TelegramUserService(client);

    await expect(service.getMe()).resolves.toEqual(aGramUser());
    // isConnected() defaults to true, so the service skips its lazy connect.
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('exercises the lazy-connect path when isConnected is false', async () => {
    const client = createMockGramClient({
      isConnected: jest.fn().mockReturnValue(false),
    });
    const service = new TelegramUserService(client);

    await service.getMe();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
});

describe('provideMockGramClient', () => {
  it('binds a supplied client to the TELEGRAM_GRAM_CLIENT token', () => {
    const client = createMockGramClient();
    const provider = provideMockGramClient(client);

    expect(provider.provide).toBe(TELEGRAM_GRAM_CLIENT);
    expect(provider.useValue).toBe(client);
  });

  it('builds a default client when none is supplied', async () => {
    const provider = provideMockGramClient();

    expect(provider.provide).toBe(TELEGRAM_GRAM_CLIENT);
    expect(jest.isMockFunction(provider.useValue.getMe)).toBe(true);
    await expect(provider.useValue.getMe()).resolves.toEqual(aGramUser());
  });

  it('registers the fake under the token in a TestingModule', async () => {
    const client = createMockGramClient({
      getMe: jest.fn().mockResolvedValue(aGramUser({ id: '42' })),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [TelegramUserService, provideMockGramClient(client)],
    }).compile();

    // The token resolves to our fake...
    expect(moduleRef.get(TELEGRAM_GRAM_CLIENT)).toBe(client);

    // ...and the real service injected it.
    const service = moduleRef.get(TelegramUserService);
    await expect(service.getMe()).resolves.toEqual(aGramUser({ id: '42' }));
    expect(client.getMe).toHaveBeenCalledTimes(1);
  });
});
