/**
 * @file src/lib/client/telegram-client.module.spec.ts
 *
 * PURPOSE
 * -------
 * Integration test proving the MTProto module's DI wiring. A `clientFactory`
 * supplies an in-memory fake {@link IGramClient}, and `autoConnect` is disabled,
 * so the module resolves the services without any GramJS network activity.
 */

import { Test } from '@nestjs/testing';
import type { IGramClient } from './gram-client.interface';
import type { GramUser } from './gram-client.types';
import { TELEGRAM_GRAM_CLIENT } from './telegram-client.constants';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramClientModule } from './telegram-client.module';
import { TelegramUserService } from './telegram-user.service';

/** A representative user DTO returned by the fake. */
const FAKE_USER: GramUser = {
  id: '42',
  isSelf: true,
  isBot: false,
  isPremium: false,
  username: 'me',
};

/** Builds a no-network fake client for the module under test. */
function createFakeClient(): IGramClient {
  return {
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
    sendMessage: jest.fn(),
    exportSession: jest.fn().mockReturnValue('S'),
  };
}

describe('TelegramClientModule', () => {
  it('forRoot wires the client and both services (no network)', async () => {
    const fake = createFakeClient();

    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramClientModule.forRoot({
          apiId: 1,
          apiHash: 'hash',
          autoConnect: false,
          clientFactory: () => fake,
        }),
      ],
    }).compile();

    const client = moduleRef.get<IGramClient>(TELEGRAM_GRAM_CLIENT);
    const auth = moduleRef.get(TelegramAuthService);
    const user = moduleRef.get(TelegramUserService);

    expect(client).toBe(fake);
    expect(auth).toBeInstanceOf(TelegramAuthService);
    expect(user).toBeInstanceOf(TelegramUserService);

    await expect(user.getMe()).resolves.toEqual(FAKE_USER);
    await expect(auth.isAuthorized()).resolves.toBe(true);
  });

  it('forRootAsync resolves options from a factory', async () => {
    const fake = createFakeClient();

    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramClientModule.forRootAsync({
          useFactory: () => ({
            apiId: 2,
            apiHash: 'h2',
            autoConnect: false,
            clientFactory: () => fake,
          }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(TelegramUserService)).toBeInstanceOf(
      TelegramUserService,
    );
  });
});
