/**
 * @file src/lib/bot/telegram-bot.observability.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the bot facade's observability wiring at the `exec` chokepoint:
 * a successful `send*` bumps `messagesSent` (but `sendChatAction` does not); a
 * failure bumps `apiErrors`, plus `floodWaits` when Telegram returns a
 * `retry_after`; and every call is wrapped in a tracing span. A recording mock
 * Telegraf and an in-memory recorder keep it network-free.
 */

import type { Telegraf } from 'telegraf';

import {
  InMemoryTelegramMetrics,
  type TelegramSpanAttributes,
  type TelegramTracer,
} from '../common';
import { TelegramBotService } from './telegram-bot.service';

/** Builds a mock Telegraf exposing just the `telegram` methods exercised here. */
function createMockBot(): {
  bot: Telegraf;
  telegram: {
    sendMessage: jest.Mock;
    sendChatAction: jest.Mock;
    getMe: jest.Mock;
  };
} {
  const telegram = {
    sendMessage: jest.fn(),
    sendChatAction: jest.fn(),
    getMe: jest.fn(),
  };
  const bot = { telegram } as unknown as Telegraf;
  return { bot, telegram };
}

/** A tracer that records the spans it opened, then runs the operation. */
function createRecordingTracer(): {
  tracer: TelegramTracer;
  spans: { name: string; attributes?: TelegramSpanAttributes }[];
} {
  const spans: { name: string; attributes?: TelegramSpanAttributes }[] = [];
  const tracer: TelegramTracer = {
    startActiveSpan(name, fn, attributes) {
      spans.push({ name, attributes });
      return fn();
    },
  };
  return { tracer, spans };
}

/** Builds a service wired with a fresh recorder + recording tracer. */
function createService(): {
  service: TelegramBotService;
  telegram: ReturnType<typeof createMockBot>['telegram'];
  metrics: InMemoryTelegramMetrics;
  spans: ReturnType<typeof createRecordingTracer>['spans'];
} {
  const { bot, telegram } = createMockBot();
  const metrics = new InMemoryTelegramMetrics();
  const { tracer, spans } = createRecordingTracer();
  const service = new TelegramBotService(
    bot,
    { token: '123:abc', launch: false },
    metrics,
    tracer,
  );
  return { service, telegram, metrics, spans };
}

describe('TelegramBotService observability', () => {
  describe('metrics', () => {
    it('bumps messagesSent on a successful send and traces the call', async () => {
      const { service, telegram, metrics, spans } = createService();
      telegram.sendMessage.mockResolvedValue({ message_id: 1 });

      await service.sendMessage(42, 'hi');

      expect(metrics.snapshot().messagesSent).toBe(1);
      expect(spans).toEqual([
        {
          name: 'telegram.bot.sendMessage',
          attributes: { 'telegram.bot.method': 'sendMessage' },
        },
      ]);
    });

    it('does not count sendChatAction as a message sent', async () => {
      const { service, telegram, metrics } = createService();
      telegram.sendChatAction.mockResolvedValue(true);

      await service.sendChatAction(42, 'typing');

      expect(metrics.snapshot().messagesSent).toBe(0);
    });

    it('does not count a non-send call (getMe) as a message sent', async () => {
      const { service, telegram, metrics } = createService();
      telegram.getMe.mockResolvedValue({ id: 1 });

      await service.getMe();

      expect(metrics.snapshot().messagesSent).toBe(0);
    });

    it('bumps apiErrors on a plain failure', async () => {
      const { service, telegram, metrics } = createService();
      telegram.sendMessage.mockRejectedValue({ code: 400, message: 'Bad' });

      await service.sendMessage(42, 'hi').catch(() => undefined);

      const snap = metrics.snapshot();
      expect(snap.apiErrors).toBe(1);
      expect(snap.floodWaits).toBe(0);
      expect(snap.messagesSent).toBe(0);
    });

    it('bumps both apiErrors and floodWaits on a 429 with retry_after', async () => {
      const { service, telegram, metrics } = createService();
      telegram.sendMessage.mockRejectedValue({
        response: { error_code: 429, parameters: { retry_after: 5 } },
        message: 'Too Many',
      });

      await service.sendMessage(42, 'hi').catch(() => undefined);

      const snap = metrics.snapshot();
      expect(snap.apiErrors).toBe(1);
      expect(snap.floodWaits).toBe(1);
    });
  });

  describe('defaults', () => {
    it('works with no recorder/tracer wired (no-op fallbacks)', async () => {
      const { bot, telegram } = createMockBot();
      telegram.sendMessage.mockResolvedValue({ message_id: 7 });
      const service = new TelegramBotService(bot, {
        token: '123:abc',
        launch: false,
      });

      await expect(service.sendMessage(1, 'x')).resolves.toEqual({
        message_id: 7,
      });
    });
  });
});
