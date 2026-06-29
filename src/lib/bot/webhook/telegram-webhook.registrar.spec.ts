/**
 * @file src/lib/bot/webhook/telegram-webhook.registrar.spec.ts
 *
 * PURPOSE
 * -------
 * Unit tests for the bootstrap registrar: it calls `setWebhook` (with the joined
 * URL and secret token) only when opted in, stays silent otherwise, warns when no
 * secret is configured, and never lets a `setWebhook` failure escape bootstrap.
 */

import { Logger } from '@nestjs/common';
import type { Telegraf } from 'telegraf';

import type { TelegramBotWebhookOptions } from './telegram-webhook.options';
import { TelegramWebhookRegistrar } from './telegram-webhook.registrar';

/** A fake Telegraf exposing only the `telegram.setWebhook` method under test. */
interface FakeBot {
  bot: Telegraf;
  setWebhook: jest.Mock;
}

/** Builds a fake Telegraf whose `setWebhook` resolves (or rejects) on demand. */
function createFakeBot(
  setWebhook = jest.fn().mockResolvedValue(true),
): FakeBot {
  const bot = { telegram: { setWebhook } } as unknown as Telegraf;
  return { bot, setWebhook };
}

describe('TelegramWebhookRegistrar', () => {
  it('registers the webhook on bootstrap when opted in', async () => {
    const { bot, setWebhook } = createFakeBot();
    const options: TelegramBotWebhookOptions = {
      path: '/tg/hook',
      domain: 'https://bot.example.com',
      secretToken: 's3cr3t',
      registerOnBootstrap: true,
    };

    await new TelegramWebhookRegistrar(bot, options).onApplicationBootstrap();

    expect(setWebhook).toHaveBeenCalledTimes(1);
    expect(setWebhook).toHaveBeenCalledWith('https://bot.example.com/tg/hook', {
      secret_token: 's3cr3t',
    });
  });

  it('does not call setWebhook when registerOnBootstrap is falsy', async () => {
    const { bot, setWebhook } = createFakeBot();
    const options: TelegramBotWebhookOptions = {
      path: '/tg/hook',
      secretToken: 's3cr3t',
    };

    await new TelegramWebhookRegistrar(bot, options).onApplicationBootstrap();

    expect(setWebhook).not.toHaveBeenCalled();
  });

  it('warns when the webhook route has no secret token', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { bot } = createFakeBot();
    const options: TelegramBotWebhookOptions = { path: '/tg/hook' };

    await new TelegramWebhookRegistrar(bot, options).onApplicationBootstrap();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT authenticated'),
    );
  });

  it('does not warn when a secret token is configured', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { bot } = createFakeBot();
    const options: TelegramBotWebhookOptions = {
      path: '/tg/hook',
      secretToken: 's3cr3t',
    };

    await new TelegramWebhookRegistrar(bot, options).onApplicationBootstrap();

    expect(warn).not.toHaveBeenCalled();
  });

  it('swallows and logs a setWebhook failure instead of throwing', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const { bot } = createFakeBot(failing);
    const options: TelegramBotWebhookOptions = {
      path: '/tg/hook',
      domain: 'https://bot.example.com',
      secretToken: 's3cr3t',
      registerOnBootstrap: true,
    };

    await expect(
      new TelegramWebhookRegistrar(bot, options).onApplicationBootstrap(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('stringifies a non-Error setWebhook rejection in the log', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failing = jest.fn().mockRejectedValue('plain-string-failure');
    const { bot } = createFakeBot(failing);
    const options: TelegramBotWebhookOptions = {
      path: '/tg/hook',
      domain: 'https://bot.example.com',
      secretToken: 's3cr3t',
      registerOnBootstrap: true,
    };

    await expect(
      new TelegramWebhookRegistrar(bot, options).onApplicationBootstrap(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('plain-string-failure'),
    );
  });
});
