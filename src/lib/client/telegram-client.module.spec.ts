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

import type { TelegramMetrics } from '../common';
import type { IGramClient } from './gram-client.interface';
import type { GramUser } from './gram-client.types';
import { TelegramAuthService } from './telegram-auth.service';
import {
  TELEGRAM_CLIENT_METRICS,
  TELEGRAM_GRAM_CLIENT,
} from './telegram-client.constants';
import { TelegramClientHealthIndicator } from './telegram-client.health';
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
    signInWithQrCode: jest.fn(),
    signInAsBot: jest.fn(),
    updateTwoFactor: jest.fn(),
    logOut: jest.fn(),
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
    exportSession: jest.fn().mockReturnValue('S'),
    onNewMessage: jest.fn().mockReturnValue(() => undefined),
    onEditedMessage: jest.fn().mockReturnValue(() => undefined),
    onDeletedMessages: jest.fn().mockReturnValue(() => undefined),
    onChatAction: jest.fn().mockReturnValue(() => undefined),
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

  describe('observability wiring', () => {
    it('provides per-account metrics and a health indicator', async () => {
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

      const metrics = moduleRef.get<TelegramMetrics>(TELEGRAM_CLIENT_METRICS);
      expect(metrics.snapshot()).toEqual({
        messagesSent: 0,
        messagesReceived: 0,
        apiErrors: 0,
        floodWaits: 0,
      });

      const health = moduleRef.get(TelegramClientHealthIndicator);
      await expect(health.isHealthy()).resolves.toEqual({
        'telegram-client': {
          status: 'up',
          connected: true,
          authorized: true,
          error: undefined,
        },
      });
    });

    it('uses a custom metrics recorder supplied via options', async () => {
      const fake = createFakeClient();
      (fake.sendMessage as jest.Mock).mockResolvedValue({ id: 1 });
      const increments: string[] = [];
      const custom = {
        increment: (counter: string) => increments.push(counter),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          TelegramClientModule.forRoot({
            apiId: 1,
            apiHash: 'hash',
            autoConnect: false,
            clientFactory: () => fake,
            metrics: custom,
          }),
        ],
      }).compile();

      // The token resolves to the supplied recorder, and the facade records into it.
      expect(moduleRef.get(TELEGRAM_CLIENT_METRICS)).toBe(custom);
      await moduleRef.get(TelegramUserService).sendMessage('me', 'hi');
      expect(increments).toContain('messagesSent');
    });

    it('records sends into the user facade through DI', async () => {
      const fake = createFakeClient();
      (fake.sendMessage as jest.Mock).mockResolvedValue({ id: 1 });

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

      const user = moduleRef.get(TelegramUserService);
      const metrics = moduleRef.get<TelegramMetrics>(TELEGRAM_CLIENT_METRICS);

      await user.sendMessage('me', 'hi');

      expect(metrics.snapshot().messagesSent).toBe(1);
    });
  });
});
