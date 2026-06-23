/**
 * @file src/lib/bot/telegram-bot.module.spec.ts
 *
 * PURPOSE
 * -------
 * Integration test proving the Bot API module's DI wiring: `forRoot` resolves
 * the typed service and the raw bot token. A dummy token is used; no network is
 * touched because automatic launch is disabled.
 */

import { Test } from '@nestjs/testing';
import { Telegraf } from 'telegraf';

import { NOOP_TELEGRAM_TRACER, type TelegramMetrics } from '../common';
import {
  TELEGRAM_BOT,
  TELEGRAM_BOT_METRICS,
  TELEGRAM_BOT_TRACER,
} from './telegram-bot.constants';
import { TelegramBotHealthIndicator } from './telegram-bot.health';
import { TelegramBotModule } from './telegram-bot.module';
import { TelegramBotService } from './telegram-bot.service';

describe('TelegramBotModule', () => {
  it('forRoot wires the service and bot instance', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelegramBotModule.forRoot({ token: '123:abc', launch: false })],
    }).compile();

    const service = moduleRef.get(TelegramBotService);
    const bot = moduleRef.get<Telegraf>(TELEGRAM_BOT);

    expect(service).toBeInstanceOf(TelegramBotService);
    expect(bot).toBeInstanceOf(Telegraf);
    expect(service.instance).toBe(bot);
  });

  it('forRootAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRootAsync({
          useFactory: () => ({ token: '999:xyz', launch: false }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(TelegramBotService)).toBeInstanceOf(
      TelegramBotService,
    );
  });

  describe('observability wiring', () => {
    it('provides per-bot metrics, a no-op tracer, and a health indicator', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TelegramBotModule.forRoot({ token: '123:abc', launch: false }),
        ],
      }).compile();

      const metrics = moduleRef.get<TelegramMetrics>(TELEGRAM_BOT_METRICS);
      expect(metrics.snapshot()).toEqual({
        messagesSent: 0,
        messagesReceived: 0,
        apiErrors: 0,
        floodWaits: 0,
      });
      expect(moduleRef.get(TELEGRAM_BOT_TRACER)).toBe(NOOP_TELEGRAM_TRACER);
      expect(moduleRef.get(TelegramBotHealthIndicator)).toBeInstanceOf(
        TelegramBotHealthIndicator,
      );
    });

    it('records sends into the bot facade through DI', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TelegramBotModule.forRoot({ token: '123:abc', launch: false }),
        ],
      }).compile();

      const service = moduleRef.get(TelegramBotService);
      const metrics = moduleRef.get<TelegramMetrics>(TELEGRAM_BOT_METRICS);
      // ── Spy on the real Telegraf method so no network is touched. ────────────
      jest
        .spyOn(service.instance.telegram, 'sendMessage')
        .mockResolvedValue({ message_id: 1 } as Awaited<
          ReturnType<Telegraf['telegram']['sendMessage']>
        >);

      await service.sendMessage(42, 'hi');

      expect(metrics.snapshot().messagesSent).toBe(1);
    });
  });
});
