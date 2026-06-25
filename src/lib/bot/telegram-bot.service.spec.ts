/**
 * @file src/lib/bot/telegram-bot.service.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the Bot API facade. A mock `Telegraf` stands in for the real
 * instance so delegation, error wrapping, and lifecycle behaviour are verified
 * without any network access.
 */

import type { Telegraf } from 'telegraf';

import { TelegramBotApiError } from '../common';
import type { TelegramBotModuleOptions } from './telegram-bot.options';
import { TelegramBotService } from './telegram-bot.service';

/** Builds a mock Telegraf instance exposing only what the facade touches. */
function createMockBot(): {
  bot: Telegraf;
  telegram: {
    sendMessage: jest.Mock;
    getMe: jest.Mock;
    answerInlineQuery: jest.Mock;
  };
  launch: jest.Mock;
  stop: jest.Mock;
} {
  const telegram = {
    sendMessage: jest.fn(),
    getMe: jest.fn(),
    answerInlineQuery: jest.fn(),
  };
  const launch = jest.fn().mockResolvedValue(undefined);
  const stop = jest.fn();
  const bot = {
    telegram,
    launch,
    stop,
    webhookCallback: jest.fn().mockReturnValue('middleware'),
  } as unknown as Telegraf;
  return { bot, telegram, launch, stop };
}

/** Builds a service over a fresh mock bot with the given options. */
function createService(
  options: Partial<TelegramBotModuleOptions> = {},
): ReturnType<typeof createMockBot> & { service: TelegramBotService } {
  const mock = createMockBot();
  const service = new TelegramBotService(mock.bot, {
    token: '123:abc',
    ...options,
  });
  return { ...mock, service };
}

/** Flushes pending microtasks/immediates (for fire-and-forget launch). */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('TelegramBotService', () => {
  describe('messaging', () => {
    it('delegates sendMessage and returns the result', async () => {
      const { service, telegram } = createService();
      const sent = { message_id: 1 };
      telegram.sendMessage.mockResolvedValue(sent);

      const result = await service.sendMessage(42, 'hi');

      expect(telegram.sendMessage).toHaveBeenCalledWith(42, 'hi');
      expect(result).toBe(sent);
    });

    it('wraps a Telegram error exposing .code', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockRejectedValue({
        code: 429,
        message: 'Too Many',
      });

      const error = await service
        .sendMessage(42, 'hi')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramBotApiError);
      expect(error).toMatchObject({ statusCode: 429, method: 'sendMessage' });
    });

    it('wraps a Telegram error exposing response.error_code', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockRejectedValue({
        response: { error_code: 400, description: 'Bad Request' },
        message: 'Bad Request',
      });

      const error = await service
        .sendMessage(42, 'hi')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramBotApiError);
      expect((error as TelegramBotApiError).statusCode).toBe(400);
    });

    it('delegates getMe', async () => {
      const { service, telegram } = createService();
      telegram.getMe.mockResolvedValue({ id: 7, is_bot: true });
      await expect(service.getMe()).resolves.toEqual({ id: 7, is_bot: true });
    });

    it('delegates answerInlineQuery and returns true', async () => {
      const { service, telegram } = createService();
      telegram.answerInlineQuery.mockResolvedValue(true);
      const results = [
        { type: 'article', id: '1', title: 'x', input_message_content: { message_text: 'y' } },
      ] as Parameters<TelegramBotService['answerInlineQuery']>[1];

      await expect(
        service.answerInlineQuery('q1', results, { cache_time: 0 }),
      ).resolves.toBe(true);
      expect(telegram.answerInlineQuery).toHaveBeenCalledWith('q1', results, {
        cache_time: 0,
      });
    });

    it('wraps a non-Error rejection with no status code (String fallback)', async () => {
      const { service, telegram } = createService();
      telegram.sendMessage.mockRejectedValue('plain string failure');

      const error = await service.sendMessage(1, 'x').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramBotApiError);
      expect((error as TelegramBotApiError).statusCode).toBeUndefined();
      expect((error as TelegramBotApiError).message).toContain(
        'plain string failure',
      );
    });
  });

  describe('raw accessors', () => {
    it('exposes the underlying instance and telegram client', () => {
      const { service, bot, telegram } = createService();
      expect(service.instance).toBe(bot);
      expect(service.telegram).toBe(telegram);
    });

    it('delegates webhookCallback', () => {
      const { service } = createService();
      expect(service.webhookCallback('/hook')).toBe('middleware');
    });
  });

  describe('callback-data codec wrappers', () => {
    it('encodes/decodes structured callback data round-trip', () => {
      const { service } = createService();
      const encoded = service.encodeCallbackData({ a: 'page', n: 3 });
      expect(service.decodeCallbackData(encoded)).toEqual({ a: 'page', n: 3 });
    });

    it('encodes a callback-action envelope via encodeCallbackAction', () => {
      const { service } = createService();
      const encoded = service.encodeCallbackAction('buy', { id: 42 });
      expect(JSON.parse(encoded)).toEqual({ a: 'buy', d: { id: 42 } });
    });
  });

  describe('lifecycle', () => {
    it('does not launch when options.launch === false', async () => {
      const { service, launch } = createService({ launch: false });
      await service.onApplicationBootstrap();
      expect(launch).not.toHaveBeenCalled();
    });

    it('launches in long-polling mode by default (no args)', async () => {
      const { service, launch } = createService();
      await service.onApplicationBootstrap();
      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch).toHaveBeenCalledWith();
    });

    it('passes webhook launch options through when provided', async () => {
      const launchOptions = { webhook: { domain: 'https://x', path: '/h' } };
      const { service, launch } = createService({ launchOptions });
      await service.launch();
      expect(launch).toHaveBeenCalledWith(launchOptions);
    });

    it('passes non-webhook (polling) launch options through', async () => {
      const launchOptions = { dropPendingUpdates: true };
      const { service, launch } = createService({ launchOptions });
      await service.launch();
      expect(launch).toHaveBeenCalledWith(launchOptions);
    });

    it('is idempotent — a second launch does not call Telegraf again', async () => {
      const { service, launch } = createService();
      await service.launch();
      await service.launch();
      expect(launch).toHaveBeenCalledTimes(1);
    });

    it('resets launched state if launch rejects', async () => {
      const { service, launch } = createService();
      launch.mockRejectedValueOnce(new Error('network'));
      await service.launch();
      await flush();
      // ── After the failed launch settles, a retry should call Telegraf again.
      await service.launch();
      expect(launch).toHaveBeenCalledTimes(2);
    });

    it('stops only when running', () => {
      const { service, stop } = createService();
      service.stop('first');
      expect(stop).not.toHaveBeenCalled();
    });

    it('stops the bot after launch and on shutdown', async () => {
      const { service, stop } = createService();
      await service.launch();
      await service.onApplicationShutdown('SIGTERM');
      expect(stop).toHaveBeenCalledWith('SIGTERM');
    });

    it('does not stop on shutdown when never launched', async () => {
      const { service, stop } = createService();
      await service.onApplicationShutdown('SIGINT');
      expect(stop).not.toHaveBeenCalled();
    });

    it('stops the bot on module destroy (works without enableShutdownHooks)', async () => {
      const { service, stop } = createService();
      await service.launch();
      await service.onModuleDestroy();
      expect(stop).toHaveBeenCalledWith('module destroy');
    });

    it('swallows a racing "Bot is not running!" error from stop()', async () => {
      const { service, stop } = createService();
      stop.mockImplementation(() => {
        throw new Error('Bot is not running!');
      });
      await service.launch();
      expect(() => service.stop('race')).not.toThrow();
    });
  });
});
