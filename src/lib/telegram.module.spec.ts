/**
 * @file src/lib/telegram.module.spec.ts
 *
 * PURPOSE
 * -------
 * Tests for the umbrella module: composition of both sub-modules, conditional
 * inclusion, and the empty/no-op case.
 */

import { Test } from '@nestjs/testing';
import { TelegramBotService } from './bot/telegram-bot.service';
import type { IGramClient } from './client/gram-client.interface';
import { TelegramUserService } from './client/telegram-user.service';
import { TelegramModule } from './telegram.module';

/** Minimal no-network fake client. */
function fakeClient(): IGramClient {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
    isAuthorized: jest.fn().mockResolvedValue(true),
    sendCode: jest.fn(),
    signInWithCode: jest.fn(),
    signInWithPassword: jest.fn(),
    logOut: jest.fn(),
    getMe: jest.fn(),
    getDialogs: jest.fn(),
    getMessages: jest.fn(),
    sendMessage: jest.fn(),
    exportSession: jest.fn().mockReturnValue(''),
  };
}

describe('TelegramModule', () => {
  it('forRoot composes both the bot and client sub-modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramModule.forRoot({
          isGlobal: true,
          bot: { token: '1:abc', launch: false },
          client: {
            apiId: 1,
            apiHash: 'h',
            autoConnect: false,
            clientFactory: () => fakeClient(),
          },
        }),
      ],
    }).compile();

    expect(moduleRef.get(TelegramBotService, { strict: false })).toBeInstanceOf(
      TelegramBotService,
    );
    expect(
      moduleRef.get(TelegramUserService, { strict: false }),
    ).toBeInstanceOf(TelegramUserService);
  });

  it('forRoot with only a bot omits the client module', () => {
    const dynamic = TelegramModule.forRoot({
      bot: { token: '1:abc', launch: false },
    });
    expect(dynamic.imports).toHaveLength(1);
  });

  it('forRoot with neither yields an empty module', () => {
    const dynamic = TelegramModule.forRoot({});
    expect(dynamic.imports).toHaveLength(0);
    expect(dynamic.global).toBe(false);
  });
});
