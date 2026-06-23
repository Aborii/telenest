/**
 * @file src/lib/bot/telegram-bot.health.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the Bot API health indicator. A stub `TelegramBotService`
 * stands in for the facade so reachability is verified without any network: a
 * successful `getMe` yields `up` (with id/username), a failure yields `down`.
 */

import { HEALTH_STATUSES } from '../common';
import { TelegramBotHealthIndicator } from './telegram-bot.health';
import type { TelegramBotService } from './telegram-bot.service';

/** Builds an indicator over a stub bot whose `getMe` behaves as configured. */
function createIndicator(getMe: jest.Mock): TelegramBotHealthIndicator {
  return new TelegramBotHealthIndicator({
    getMe,
  } as unknown as TelegramBotService);
}

describe('TelegramBotHealthIndicator', () => {
  it('reports up with id/username under the default key', async () => {
    const getMe = jest.fn().mockResolvedValue({ id: 42, username: 'my_bot' });
    const result = await createIndicator(getMe).isHealthy();

    expect(result).toEqual({
      'telegram-bot': {
        status: HEALTH_STATUSES.UP,
        id: 42,
        username: 'my_bot',
      },
    });
  });

  it('uses the supplied key', async () => {
    const getMe = jest.fn().mockResolvedValue({ id: 1, username: 'b' });
    const result = await createIndicator(getMe).isHealthy('bot:notify');

    expect(result['bot:notify']?.status).toBe(HEALTH_STATUSES.UP);
  });

  it('reports down with the error message when getMe fails', async () => {
    const getMe = jest.fn().mockRejectedValue(new Error('401 Unauthorized'));
    const result = await createIndicator(getMe).isHealthy();

    expect(result).toEqual({
      'telegram-bot': {
        status: HEALTH_STATUSES.DOWN,
        error: '401 Unauthorized',
      },
    });
  });

  it('never throws even when getMe rejects', async () => {
    const getMe = jest.fn().mockRejectedValue(new Error('down'));
    await expect(createIndicator(getMe).isHealthy()).resolves.toBeDefined();
  });
});
