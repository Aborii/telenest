/**
 * @file src/lib/bot/telegram-bot.multi-bot.spec.ts
 *
 * PURPOSE
 * -------
 * Integration tests for running multiple named bots in one application. They
 * prove the issue's acceptance criteria end-to-end: two bots register, inject,
 * and launch independently without token collisions; `@TelegramUpdate({ bot })`
 * scopes handlers to exactly one bot; the default bot coexists with named bots
 * without leaking handlers; and `@InjectBot(name)` resolves each typed facade.
 *
 * No network is touched: each bot's raw `Telegraf` is overridden with a recording
 * mock, and the per-bot registrar's `onModuleInit` is invoked directly (Nest does
 * not run lifecycle hooks during `compile()`), so nothing is ever launched.
 */

import { type DynamicModule, Injectable, type Provider } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Context, Telegraf } from 'telegraf';

import { TelegramBotModule } from './telegram-bot.module';
import { TelegramBotService } from './telegram-bot.service';
import {
  getBotInstanceToken,
  getBotRegistrarToken,
  getBotToken,
  InjectBot,
} from './telegram-bot.tokens';
import { Ctx } from './updates/param.decorators';
import type { TelegramBotUpdatesRegistrar } from './updates/telegram-bot-updates.registrar';
import { Command, TelegramUpdate } from './updates/telegram-update.decorator';

/** A recorded handler registration on a mock bot: which method + trigger. */
interface Registration {
  method: string;
  trigger?: unknown;
}

/** A recording mock `Telegraf` plus its captured registrations and launch/stop. */
interface MockBot {
  bot: Telegraf;
  regs: Registration[];
  launch: jest.Mock;
  stop: jest.Mock;
}

/** Builds a mock Telegraf that records every handler registration. */
function createRecordingBot(): MockBot {
  const regs: Registration[] = [];
  const withTrigger = (method: string): jest.Mock =>
    jest.fn((trigger: unknown) => {
      regs.push({ method, trigger });
    });
  const launch = jest.fn().mockResolvedValue(undefined);
  const stop = jest.fn();
  const bot = {
    start: jest.fn(() => regs.push({ method: 'start' })),
    help: jest.fn(() => regs.push({ method: 'help' })),
    use: jest.fn(() => regs.push({ method: 'use' })),
    command: withTrigger('command'),
    hears: withTrigger('hears'),
    action: withTrigger('action'),
    on: withTrigger('on'),
    launch,
    stop,
  };
  return { bot: bot as unknown as Telegraf, regs, launch, stop };
}

// ── Update providers, each scoped to a different bot. ─────────────────────────

/** Handlers for the `notify` bot. */
@TelegramUpdate({ bot: 'notify' })
@Injectable()
class NotifyUpdate {
  @Command('ping')
  public onPing(@Ctx() _ctx: Context): void {
    // No-op: these tests assert *which bot* the handler binds to, not dispatch.
    void _ctx;
  }
}

/** Handlers for the `support` bot. */
@TelegramUpdate({ bot: 'support' })
@Injectable()
class SupportUpdate {
  @Command('ticket')
  public onTicket(@Ctx() _ctx: Context): void {
    void _ctx;
  }
}

/** Handlers for the default (unnamed) bot. */
@TelegramUpdate()
@Injectable()
class DefaultUpdate {
  @Command('home')
  public onHome(@Ctx() _ctx: Context): void {
    void _ctx;
  }
}

/** A consumer that injects two named facades by name. */
@Injectable()
class BroadcastService {
  public constructor(
    @InjectBot('notify') public readonly notify: TelegramBotService,
    @InjectBot('support') public readonly support: TelegramBotService,
  ) {}
}

/** Compiles a testing module, applying raw-instance overrides before compile. */
async function compile(
  imports: DynamicModule[],
  providers: Provider[],
  overrides: ReadonlyArray<{
    token: ReturnType<typeof getBotInstanceToken>;
    bot: Telegraf;
  }>,
): Promise<TestingModule> {
  let builder = Test.createTestingModule({ imports, providers });
  for (const override of overrides)
    builder = builder.overrideProvider(override.token).useValue(override.bot);
  return builder.compile();
}

describe('TelegramBotModule — multiple named bots', () => {
  it('wires an isolated facade bound to each bot’s own instance', async () => {
    const notify = createRecordingBot();
    const support = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
        }),
        TelegramBotModule.forRoot({
          name: 'support',
          token: '222:bbb',
          launch: false,
        }),
      ],
      [],
      [
        { token: getBotInstanceToken('notify'), bot: notify.bot },
        { token: getBotInstanceToken('support'), bot: support.bot },
      ],
    );

    const notifySvc = moduleRef.get<TelegramBotService>(getBotToken('notify'), {
      strict: false,
    });
    const supportSvc = moduleRef.get<TelegramBotService>(
      getBotToken('support'),
      { strict: false },
    );

    expect(notifySvc).toBeInstanceOf(TelegramBotService);
    expect(supportSvc).toBeInstanceOf(TelegramBotService);
    expect(notifySvc).not.toBe(supportSvc);
    // ── Each facade is bound to its own bot's raw instance, not the other's. ──
    expect(notifySvc.instance).toBe(notify.bot);
    expect(supportSvc.instance).toBe(support.bot);
  });

  it('scopes @TelegramUpdate handlers to the matching bot only', async () => {
    const notify = createRecordingBot();
    const support = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
        }),
        TelegramBotModule.forRoot({
          name: 'support',
          token: '222:bbb',
          launch: false,
        }),
      ],
      [NotifyUpdate, SupportUpdate],
      [
        { token: getBotInstanceToken('notify'), bot: notify.bot },
        { token: getBotInstanceToken('support'), bot: support.bot },
      ],
    );

    // ── Lifecycle hooks do not run during compile(); bind handlers by hand. ───
    moduleRef
      .get<TelegramBotUpdatesRegistrar>(getBotRegistrarToken('notify'), {
        strict: false,
      })
      .onModuleInit();
    moduleRef
      .get<TelegramBotUpdatesRegistrar>(getBotRegistrarToken('support'), {
        strict: false,
      })
      .onModuleInit();

    expect(notify.regs).toEqual([{ method: 'command', trigger: 'ping' }]);
    expect(support.regs).toEqual([{ method: 'command', trigger: 'ticket' }]);
  });

  it('lets the default bot coexist with a named bot without leaking handlers', async () => {
    const def = createRecordingBot();
    const notify = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRoot({ token: '000:ddd', launch: false }),
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
        }),
      ],
      [DefaultUpdate, NotifyUpdate],
      [
        { token: getBotInstanceToken(), bot: def.bot },
        { token: getBotInstanceToken('notify'), bot: notify.bot },
      ],
    );

    moduleRef
      .get<TelegramBotUpdatesRegistrar>(getBotRegistrarToken(), {
        strict: false,
      })
      .onModuleInit();
    moduleRef
      .get<TelegramBotUpdatesRegistrar>(getBotRegistrarToken('notify'), {
        strict: false,
      })
      .onModuleInit();

    expect(def.regs).toEqual([{ method: 'command', trigger: 'home' }]);
    expect(notify.regs).toEqual([{ method: 'command', trigger: 'ping' }]);
  });

  it('@InjectBot(name) resolves each bot’s facade by name', async () => {
    const notify = createRecordingBot();
    const support = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
        }),
        TelegramBotModule.forRoot({
          name: 'support',
          token: '222:bbb',
          launch: false,
        }),
      ],
      [BroadcastService],
      [
        { token: getBotInstanceToken('notify'), bot: notify.bot },
        { token: getBotInstanceToken('support'), bot: support.bot },
      ],
    );

    const broadcast = moduleRef.get(BroadcastService);
    expect(broadcast.notify).toBeInstanceOf(TelegramBotService);
    expect(broadcast.support).toBeInstanceOf(TelegramBotService);
    expect(broadcast.notify).not.toBe(broadcast.support);
    expect(broadcast.notify.instance).toBe(notify.bot);
    expect(broadcast.support.instance).toBe(support.bot);
  });

  it('binds handlers automatically via the Nest lifecycle (no manual onModuleInit)', async () => {
    const notify = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
        }),
      ],
      [NotifyUpdate],
      [{ token: getBotInstanceToken('notify'), bot: notify.bot }],
    );

    // ── Run the real lifecycle. `launch: false` keeps it offline; this proves
    //    the factory-provided registrar's onModuleInit actually fires under
    //    Nest (the same wiring backs the default bot), not just when called by
    //    hand as the other specs do. ───────────────────────────────────────────
    await moduleRef.init();
    expect(notify.regs).toEqual([{ method: 'command', trigger: 'ping' }]);
    await moduleRef.close();
  });

  it('registers a named bot via forRootAsync', async () => {
    const reports = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRootAsync({
          name: 'reports',
          useFactory: () => ({ token: '333:ccc', launch: false }),
        }),
      ],
      [],
      [{ token: getBotInstanceToken('reports'), bot: reports.bot }],
    );

    const svc = moduleRef.get<TelegramBotService>(getBotToken('reports'), {
      strict: false,
    });
    expect(svc).toBeInstanceOf(TelegramBotService);
    expect(svc.instance).toBe(reports.bot);
  });

  it('launches and stops each bot independently', async () => {
    const notify = createRecordingBot();
    const support = createRecordingBot();

    const moduleRef = await compile(
      [
        TelegramBotModule.forRoot({
          name: 'notify',
          token: '111:aaa',
          launch: false,
        }),
        TelegramBotModule.forRoot({
          name: 'support',
          token: '222:bbb',
          launch: false,
        }),
      ],
      [],
      [
        { token: getBotInstanceToken('notify'), bot: notify.bot },
        { token: getBotInstanceToken('support'), bot: support.bot },
      ],
    );

    const notifySvc = moduleRef.get<TelegramBotService>(getBotToken('notify'), {
      strict: false,
    });
    const supportSvc = moduleRef.get<TelegramBotService>(
      getBotToken('support'),
      { strict: false },
    );

    // ── Launch only `notify`: `support` must be untouched. ────────────────────
    await notifySvc.launch();
    expect(notify.launch).toHaveBeenCalledTimes(1);
    expect(support.launch).not.toHaveBeenCalled();

    // ── Stop only `notify`: `support` must be untouched. ──────────────────────
    notifySvc.stop('test');
    expect(notify.stop).toHaveBeenCalledWith('test');
    expect(support.stop).not.toHaveBeenCalled();

    // ── And `support` still launches on its own. ──────────────────────────────
    await supportSvc.launch();
    expect(support.launch).toHaveBeenCalledTimes(1);
  });
});
