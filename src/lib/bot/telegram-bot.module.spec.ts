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

import { TELEGRAM_BOT } from './telegram-bot.constants';
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
});
