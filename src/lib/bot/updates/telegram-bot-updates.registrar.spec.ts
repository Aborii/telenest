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
import {
  CallbackData,
  Ctx,
  InlineQueryOffset,
  InlineQueryText,
  MessageText,
  Sender,
} from './param.decorators';
import { TelegramBotUpdatesRegistrar } from './telegram-bot-updates.registrar';
import {
  Action,
  ChosenInlineResult,
  Command,
  Hears,
  Help,
  InlineQuery,
  On,
  Start,
  TelegramUpdate,
  Use,
} from './telegram-update.decorator';

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
    inlineQuery: withTrigger('inlineQuery'),
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
  public onStart(@Ctx() _ctx: Context): void {
    this.events.push('start');
  }

  @Help()
  public onHelp(@Ctx() _ctx: Context): void {
    this.events.push('help');
  }

  @Hears('hi')
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

/** Provider exercising the inline-mode decorators and their param injection. */
@TelegramUpdate()
@Injectable()
class InlineUpdate {
  /** Ordered record of which inline handlers fired. */
  public readonly events: string[] = [];
  /** Last inline query text injected via `@InlineQueryText()`. */
  public lastQuery: string | undefined;
  /** Last inline query offset injected via `@InlineQueryOffset()`. */
  public lastOffset: string | undefined;

  @InlineQuery('weather')
  public onWeather(
    @InlineQueryText() text: string | undefined,
    @InlineQueryOffset() offset: string | undefined,
  ): void {
    this.events.push('inline:weather');
    this.lastQuery = text;
    this.lastOffset = offset;
  }

  @InlineQuery()
  public onAny(@Ctx() _ctx: Context): void {
    this.events.push('inline:any');
  }

  @ChosenInlineResult()
  public onChosen(@Ctx() _ctx: Context): void {
    this.events.push('chosen');
  }
}

/** Compiles the bot module over the mock and runs the registrar once. */
/** Base provider declaring a decorated handler. */
@TelegramUpdate()
@Injectable()
class BasePingUpdate {
  /** Records which implementation ran. */
  public readonly events: string[] = [];

  @Command('ping')
  public onPing(@Ctx() _ctx: Context): void {
    this.events.push('base-ping');
  }
}

/** Subclass overriding the decorated method WITHOUT re-decorating it. */
@TelegramUpdate()
@Injectable()
class OverridingPingUpdate extends BasePingUpdate {
  public override onPing(_ctx: Context): void {
    this.events.push('override-ping');
  }
}

async function bootstrap(providers: ReadonlyArray<new () => object>): Promise<{
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
  inlineQuery?: { query: string; offset: string };
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

  it('hoists @Use() global middleware ahead of terminal handlers', async () => {
    // ── DemoUpdate declares globalMw (@Use) last, after @Command etc.; it must
    //    still be registered first so Telegraf runs it before terminal matches. ─
    const { regs } = await bootstrap([DemoUpdate]);
    const useIndex = regs.findIndex((r) => r.method === 'use');
    const firstTerminal = regs.findIndex((r) => r.method !== 'use');

    expect(useIndex).toBe(0);
    expect(useIndex).toBeLessThan(firstTerminal);
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

  it('binds a decorated handler inherited from a base class, running the override', async () => {
    const { regs, get } = await bootstrap([OverridingPingUpdate]);
    const update = get(OverridingPingUpdate);

    // ── The inherited @Command('ping') binding is not dropped. ────────────────
    const command = regs.find((r) => r.method === 'command');
    expect(command?.trigger).toBe('ping');

    // ── Dispatching runs the SUBCLASS override (with inherited @Ctx injection). ─
    const next = jest.fn().mockResolvedValue(undefined);
    await command?.middleware(fakeContext({ text: 'ping' }), next);
    expect(update.events).toEqual(['override-ping']);
  });

  describe('inline mode', () => {
    it('binds @InlineQuery(pattern) via inlineQuery and the bare form via on', async () => {
      const { regs } = await bootstrap([InlineUpdate]);

      // ── A pattern routes through Telegraf.inlineQuery(trigger, …). ───────────
      const patterned = regs.find((r) => r.method === 'inlineQuery');
      expect(patterned?.trigger).toBe('weather');

      // ── The bare @InlineQuery() falls back to on('inline_query', …). ─────────
      const onTriggers = regs.filter((r) => r.method === 'on').map((r) => r.trigger);
      expect(onTriggers).toContain('inline_query');
    });

    it('binds @ChosenInlineResult via on(chosen_inline_result)', async () => {
      const { regs } = await bootstrap([InlineUpdate]);
      const onTriggers = regs.filter((r) => r.method === 'on').map((r) => r.trigger);
      expect(onTriggers).toContain('chosen_inline_result');
    });

    it('dispatches inline queries with injected text and offset', async () => {
      const { regs, get } = await bootstrap([InlineUpdate]);
      const inline = get(InlineUpdate);
      const next = jest.fn().mockResolvedValue(undefined);
      const ctx = fakeContext({ inlineQuery: { query: 'sun', offset: '20' } });

      for (const reg of regs) await reg.middleware(ctx, next);

      expect(inline.events.sort()).toEqual([
        'chosen',
        'inline:any',
        'inline:weather',
      ]);
      expect(inline.lastQuery).toBe('sun');
      expect(inline.lastOffset).toBe('20');
    });
  });
});
