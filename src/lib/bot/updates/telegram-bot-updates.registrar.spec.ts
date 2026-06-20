/**
 * @file src/lib/bot/updates/telegram-bot-updates.registrar.spec.ts
 *
 * PURPOSE
 * -------
 * Integration test proving the end-to-end decorator path: a `@TelegramUpdate`
 * provider is discovered, each decorated method is bound onto the (mock) Telegraf
 * instance with the right trigger, dispatch resolves injected arguments, `@Use()`
 * continues the middleware chain, errors are isolated, and unmarked classes are
 * ignored. No network: the Telegraf instance is a recording mock.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Context, Telegraf } from 'telegraf';
import { TELEGRAM_BOT } from '../telegram-bot.constants';
import { TelegramBotModule } from '../telegram-bot.module';
import { CallbackData, Ctx, MessageText, Sender } from './param.decorators';
import {
  Action,
  Command,
  Hears,
  Help,
  On,
  Start,
  TelegramUpdate,
  Use,
} from './telegram-update.decorator';
import { TelegramBotUpdatesRegistrar } from './telegram-bot-updates.registrar';

/** A recorded `Telegraf` registration: which method, optional trigger, the mw. */
interface Registration {
  method: string;
  trigger?: unknown;
  middleware: (ctx: Context, next: () => Promise<void>) => unknown;
}

/** Builds a mock Telegraf that records every handler registration. */
function createMockBot(): { bot: Telegraf; regs: Registration[] } {
  const regs: Registration[] = [];
  const noTrigger = (method: string): jest.Mock =>
    jest.fn((middleware: Registration['middleware']) => {
      regs.push({ method, middleware });
    });
  const withTrigger = (method: string): jest.Mock =>
    jest.fn((trigger: unknown, middleware: Registration['middleware']) => {
      regs.push({ method, trigger, middleware });
    });

  const bot = {
    start: noTrigger('start'),
    help: noTrigger('help'),
    use: noTrigger('use'),
    command: withTrigger('command'),
    hears: withTrigger('hears'),
    action: withTrigger('action'),
    on: withTrigger('on'),
  };
  return { bot: bot as unknown as Telegraf, regs };
}

/** Demo provider exercising every decorator and parameter injection. */
@TelegramUpdate()
@Injectable()
class DemoUpdate {
  /** Ordered record of which handlers fired. */
  public readonly events: string[] = [];
  /** Last text injected via `@MessageText()`. */
  public lastText: string | undefined;
  /** Last callback data injected via `@CallbackData()`. */
  public lastData: string | undefined;
  /** Last sender injected via `@Sender()`. */
  public lastFrom: unknown;

  @Start()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onStart(@Ctx() _ctx: Context): void {
    this.events.push('start');
  }

  @Help()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onHelp(@Ctx() _ctx: Context): void {
    this.events.push('help');
  }

  @Hears('hi')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onHi(@MessageText() _text: string | undefined): void {
    this.events.push('hears');
  }

  @Command('ping')
  public onPing(@MessageText() text: string | undefined): void {
    this.events.push('ping');
    this.lastText = text;
  }

  @Action('go')
  public onGo(@CallbackData() data: string | undefined): void {
    this.events.push('action');
    this.lastData = data;
  }

  @On('text')
  public onText(@Sender() from: unknown): void {
    this.events.push('text');
    this.lastFrom = from;
  }

  @Use()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public globalMw(@Ctx() _ctx: Context): void {
    this.events.push('use');
  }
}

/** Provider whose handler always throws (for error-isolation testing). */
@TelegramUpdate()
@Injectable()
class ThrowingUpdate {
  /** How many times the handler ran. */
  public count = 0;

  @Command('boom')
  public onBoom(): void {
    this.count += 1;
    throw new Error('handler failure');
  }
}

/** Provider marked as a normal service (no `@TelegramUpdate`) — must be ignored. */
@Injectable()
class UnmarkedUpdate {
  /** Set true if (incorrectly) invoked. */
  public called = false;

  @Command('nope')
  public onNope(): void {
    this.called = true;
  }
}

/** Compiles the bot module over the mock and runs the registrar once. */
async function bootstrap(
  providers: ReadonlyArray<new () => object>,
): Promise<{
  regs: Registration[];
  get: <T>(token: new () => T) => T;
}> {
  const { bot, regs } = createMockBot();
  const moduleRef = await Test.createTestingModule({
    imports: [TelegramBotModule.forRoot({ token: 'x', launch: false })],
    providers: [...providers],
  })
    .overrideProvider(TELEGRAM_BOT)
    .useValue(bot)
    .compile();

  const registrar = moduleRef.get(TelegramBotUpdatesRegistrar, {
    strict: false,
  });
  registrar.onModuleInit();

  return { regs, get: (token) => moduleRef.get(token) };
}

/** Builds a minimal fake context for dispatch. */
function fakeContext(partial: {
  text?: string;
  from?: { id: number };
  callbackQuery?: { data: string };
}): Context {
  return partial as unknown as Context;
}

describe('TelegramBotUpdatesRegistrar (integration)', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // ── Silence (and capture) the isolation error log. ───────────────────────
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('binds each decorated method onto Telegraf with the right trigger', async () => {
    const { regs } = await bootstrap([DemoUpdate]);

    expect(regs.map((r) => r.method).sort()).toEqual([
      'action',
      'command',
      'hears',
      'help',
      'on',
      'start',
      'use',
    ]);
    expect(regs.find((r) => r.method === 'command')?.trigger).toBe('ping');
    expect(regs.find((r) => r.method === 'hears')?.trigger).toBe('hi');
    expect(regs.find((r) => r.method === 'action')?.trigger).toBe('go');
    expect(regs.find((r) => r.method === 'on')?.trigger).toBe('text');
  });

  it('dispatches updates with resolved arguments', async () => {
    const { regs, get } = await bootstrap([DemoUpdate]);
    const demo = get(DemoUpdate);

    const ctx = fakeContext({
      text: 'ping payload',
      from: { id: 7 },
      callbackQuery: { data: 'go' },
    });
    const next = jest.fn().mockResolvedValue(undefined);

    for (const reg of regs) await reg.middleware(ctx, next);

    expect(demo.events.sort()).toEqual([
      'action',
      'hears',
      'help',
      'ping',
      'start',
      'text',
      'use',
    ]);
    expect(demo.lastText).toBe('ping payload');
    expect(demo.lastData).toBe('go');
    expect(demo.lastFrom).toEqual({ id: 7 });
  });

  it('@Use() continues the middleware chain via next()', async () => {
    const { regs } = await bootstrap([DemoUpdate]);
    const use = regs.find((r) => r.method === 'use');
    const next = jest.fn().mockResolvedValue(undefined);

    await use?.middleware(fakeContext({ text: 'x' }), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing handler (resolves, logs, does not rethrow)', async () => {
    const { regs, get } = await bootstrap([ThrowingUpdate]);
    const throwing = get(ThrowingUpdate);
    const boom = regs.find((r) => r.method === 'command');
    const next = jest.fn().mockResolvedValue(undefined);

    await expect(
      boom?.middleware(fakeContext({ text: 'boom' }), next),
    ).resolves.toBeUndefined();
    expect(throwing.count).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('ignores classes not decorated with @TelegramUpdate', async () => {
    const { regs, get } = await bootstrap([UnmarkedUpdate]);
    expect(regs).toHaveLength(0);
    expect(get(UnmarkedUpdate).called).toBe(false);
  });
});
