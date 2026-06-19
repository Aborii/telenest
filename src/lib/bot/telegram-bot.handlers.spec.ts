/**
 * @file src/lib/bot/telegram-bot.handlers.spec.ts
 *
 * PURPOSE
 * -------
 * Verifies the handler-registration delegates (`start`, `help`, `command`,
 * `hears`, `action`, `on`, `use`, `catch`) forward to the underlying Telegraf
 * instance unchanged.
 */

import type { Telegraf } from 'telegraf';
import { TelegramBotService } from './telegram-bot.service';

/** Builds a service over a mock bot exposing the registration methods. */
function createService(): {
  service: TelegramBotService;
  bot: Record<string, jest.Mock>;
} {
  const bot: Record<string, jest.Mock> = {
    start: jest.fn(),
    help: jest.fn(),
    command: jest.fn(),
    hears: jest.fn(),
    action: jest.fn(),
    on: jest.fn(),
    use: jest.fn(),
    catch: jest.fn(),
    launch: jest.fn(),
    stop: jest.fn(),
  };
  const service = new TelegramBotService(bot as unknown as Telegraf, {
    token: 'x',
    launch: false,
  });
  return { service, bot };
}

describe('TelegramBotService handler registration', () => {
  const handler = (): void => undefined;

  it('start / help / command / hears / action / on delegate to Telegraf', () => {
    const { service, bot } = createService();

    service.start(handler);
    service.help(handler);
    service.command('cmd', handler);
    service.hears('hi', handler);
    service.action('cb', handler);
    service.on('message', handler);

    expect(bot.start).toHaveBeenCalledWith(handler);
    expect(bot.help).toHaveBeenCalledWith(handler);
    expect(bot.command).toHaveBeenCalledWith('cmd', handler);
    expect(bot.hears).toHaveBeenCalledWith('hi', handler);
    expect(bot.action).toHaveBeenCalledWith('cb', handler);
    expect(bot.on).toHaveBeenCalledWith('message', handler);
  });

  it('use (bound getter) delegates to Telegraf', () => {
    const { service, bot } = createService();
    service.use(handler);
    expect(bot.use).toHaveBeenCalledWith(handler);
  });

  it('catch delegates to Telegraf', () => {
    const { service, bot } = createService();
    const onError = (): void => undefined;
    service.catch(onError);
    expect(bot.catch).toHaveBeenCalledWith(onError);
  });
});
