/**
 * @file src/lib/bot/telegram-bot.metrics-middleware.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the opt-in inbound-counting middleware: it bumps
 * `messagesReceived` exactly when an update carries a message, and always
 * defers to the rest of the middleware chain via `next`.
 */

import type { Context } from 'telegraf';

import { InMemoryTelegramMetrics } from '../common';
import { telegramBotMetricsMiddleware } from './telegram-bot.metrics-middleware';

describe('telegramBotMetricsMiddleware', () => {
  it('increments messagesReceived for a message update and calls next', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const next = jest.fn().mockResolvedValue(undefined);
    const middleware = telegramBotMetricsMiddleware(metrics);

    await middleware({ message: { text: 'hi' } } as unknown as Context, next);

    expect(metrics.snapshot().messagesReceived).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not count a non-message update but still calls next', async () => {
    const metrics = new InMemoryTelegramMetrics();
    const next = jest.fn().mockResolvedValue(undefined);
    const middleware = telegramBotMetricsMiddleware(metrics);

    await middleware(
      { callbackQuery: { id: '1' } } as unknown as Context,
      next,
    );

    expect(metrics.snapshot().messagesReceived).toBe(0);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
