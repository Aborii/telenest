/**
 * @file src/lib/bot/updates/telegram-bot-updates.registrar.commands.spec.ts
 *
 * PURPOSE
 * -------
 * Integration tests for auto-registering the Telegram command menu from
 * `@Command(name, { description })` metadata. Proves the registrar derives the
 * correct `setMyCommands` payload, is a no-op when disabled, makes one call per
 * scope, fails fast on misconfiguration, and isolates Bot API failures. The
 * Telegraf instance is a recording mock — no network.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Telegraf } from 'telegraf';

import { TelegramConfigError } from '../../common';
import { TELEGRAM_BOT } from '../telegram-bot.constants';
import { TelegramBotModule } from '../telegram-bot.module';
import type { TelegramBotModuleOptions } from '../telegram-bot.options';
import { Ctx } from './param.decorators';
import { TelegramBotUpdatesRegistrar } from './telegram-bot-updates.registrar';
import { Command, On, TelegramUpdate } from './telegram-update.decorator';

/** A recorded `setMyCommands` call: the commands and optional extra. */
interface CommandCall {
  commands: ReadonlyArray<{ command: string; description: string }>;
  extra?: { scope?: unknown; language_code?: string };
}

/** Builds a mock Telegraf that records `setMyCommands` calls. */
function createMockBot(
  setMyCommands: jest.Mock = jest.fn().mockResolvedValue(true),
): { bot: Telegraf; calls: CommandCall[]; setMyCommands: jest.Mock } {
  const calls: CommandCall[] = [];
  const recording = jest.fn(
    (commands: CommandCall['commands'], extra?: CommandCall['extra']) => {
      calls.push({ commands, extra });
      return setMyCommands(commands, extra);
    },
  );
  const bot = {
    command: jest.fn(),
    on: jest.fn(),
    telegram: { setMyCommands: recording },
  };
  return { bot: bot as unknown as Telegraf, calls, setMyCommands: recording };
}

/** A provider declaring described + undescribed commands on the default scope. */
@TelegramUpdate()
@Injectable()
class MenuUpdate {
  @Command('ping', { description: 'Check the bot is alive' })
  public onPing(@Ctx() _ctx: unknown): void {
    /* handled */
  }

  @Command(['add', 'plus'], { description: 'Add numbers' })
  public onAdd(@Ctx() _ctx: unknown): void {
    /* handled — both names share one description */
  }

  @Command('secret')
  public onSecret(@Ctx() _ctx: unknown): void {
    /* no description → handled but not listed */
  }

  @On('text')
  public onText(@Ctx() _ctx: unknown): void {
    /* not a command */
  }
}

/** Compiles the module over the mock bot and runs both lifecycle hooks. */
async function bootstrap(
  providers: ReadonlyArray<new () => object>,
  options: Partial<TelegramBotModuleOptions> = {},
  bot: Telegraf = createMockBot().bot,
): Promise<TelegramBotUpdatesRegistrar> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TelegramBotModule.forRoot({ token: 'x', launch: false, ...options }),
    ],
    providers: [...providers],
  })
    .overrideProvider(TELEGRAM_BOT)
    .useValue(bot)
    .compile();

  const registrar = moduleRef.get(TelegramBotUpdatesRegistrar, {
    strict: false,
  });
  registrar.onModuleInit();
  await registrar.onApplicationBootstrap();
  return registrar;
}

describe('TelegramBotUpdatesRegistrar — command auto-registration', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('is a no-op when autoRegister is disabled', async () => {
    const { bot, calls } = createMockBot();
    await bootstrap([MenuUpdate], {}, bot);
    expect(calls).toHaveLength(0);
  });

  it('makes one setMyCommands call with only the described commands', async () => {
    const { bot, calls } = createMockBot();
    await bootstrap([MenuUpdate], { commands: { autoRegister: true } }, bot);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.extra).toBeUndefined();
    expect(calls[0]?.commands).toEqual([
      { command: 'ping', description: 'Check the bot is alive' },
      { command: 'add', description: 'Add numbers' },
      { command: 'plus', description: 'Add numbers' },
    ]);
  });

  it('groups scoped commands into separate calls', async () => {
    @TelegramUpdate()
    @Injectable()
    class ScopedUpdate {
      @Command('start', { description: 'Default menu' })
      public onStart(@Ctx() _ctx: unknown): void {
        /* default */
      }

      @Command('admin', {
        description: 'Admin only',
        scope: { type: 'all_private_chats' },
      })
      public onAdmin(@Ctx() _ctx: unknown): void {
        /* scoped */
      }
    }

    const { bot, calls } = createMockBot();
    await bootstrap([ScopedUpdate], { commands: { autoRegister: true } }, bot);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.extra).toBeUndefined();
    expect(calls[1]?.extra).toEqual({ scope: { type: 'all_private_chats' } });
    expect(calls[1]?.commands).toEqual([
      { command: 'admin', description: 'Admin only' },
    ]);
  });

  it('forwards the language_code in the extra', async () => {
    @TelegramUpdate()
    @Injectable()
    class LangUpdate {
      @Command('hola', { description: 'Saludo', languageCode: 'es' })
      public onHola(@Ctx() _ctx: unknown): void {
        /* spanish */
      }
    }

    const { bot, calls } = createMockBot();
    await bootstrap([LangUpdate], { commands: { autoRegister: true } }, bot);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.extra).toEqual({ language_code: 'es' });
  });

  it('throws at onModuleInit for an invalid command name', async () => {
    @TelegramUpdate()
    @Injectable()
    class BadNameUpdate {
      @Command('Bad Name', { description: 'Nope' })
      public onBad(@Ctx() _ctx: unknown): void {
        /* invalid */
      }
    }

    await expect(
      bootstrap([BadNameUpdate], { commands: { autoRegister: true } }),
    ).rejects.toThrow(TelegramConfigError);
  });

  it('throws when a described command uses a RegExp trigger', async () => {
    @TelegramUpdate()
    @Injectable()
    class RegexpUpdate {
      @Command(/ping/, { description: 'Cannot be a menu entry' })
      public onPing(@Ctx() _ctx: unknown): void {
        /* regexp */
      }
    }

    await expect(
      bootstrap([RegexpUpdate], { commands: { autoRegister: true } }),
    ).rejects.toThrow(/no string command name/);
  });

  it('logs and swallows a setMyCommands failure', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('429 too many'));
    const { bot, calls } = createMockBot(failing);

    await expect(
      bootstrap([MenuUpdate], { commands: { autoRegister: true } }, bot),
    ).resolves.toBeDefined();

    expect(calls).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to register commands'),
    );
  });

  it('does not call setMyCommands when enabled but no commands are described', async () => {
    @TelegramUpdate()
    @Injectable()
    class UndescribedUpdate {
      @Command('plain')
      public onPlain(@Ctx() _ctx: unknown): void {
        /* no description */
      }
    }

    const { bot, calls } = createMockBot();
    await bootstrap(
      [UndescribedUpdate],
      { commands: { autoRegister: true } },
      bot,
    );
    expect(calls).toHaveLength(0);
  });
});
