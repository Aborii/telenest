/**
 * @file src/lib/bot/runtime/telegram-bot-runtime.service.spec.ts
 *
 * PURPOSE
 * -------
 * Behavioural tests for the runtime-reconfigurable bot manager. They prove the
 * issue-#119 acceptance criteria end to end over a network-free fake `Telegraf`
 * (`createMockTelegraf`): a bot registered with no token at boot can be configured
 * and launched at runtime, the token can be rotated/cleared with a clean
 * stop→rebuild→relaunch, a bad/revoked token or a single-poller `409` becomes
 * `error` status (never a throw), decorator handlers re-bind onto each rebuilt
 * instance, and named runtime bots stay isolated. No test touches the network.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Context } from 'telegraf';

import { TelegramConfigError } from '../../common';
import {
  asTelegraf,
  createMockTelegraf,
  type MockTelegraf,
} from '../../testing/mock-telegraf';
import { TelegramBotModule } from '../telegram-bot.module';
import { Command, Start, TelegramUpdate } from '../updates';
import { getBotRuntimeToken } from './telegram-bot-runtime.constants';
import { TelegramBotRuntime } from './telegram-bot-runtime.service';
import { BOT_RUNTIME_STATUSES } from './telegram-bot-runtime.types';

/** Default-bot handler provider; its `@Command`/`@Start` should bind on configure. */
@TelegramUpdate()
@Injectable()
class DefaultUpdate {
  /** Ordered record of which handlers fired (unused here; binding is what matters). */
  public readonly events: string[] = [];

  @Start()
  public onStart(_ctx: Context): void {
    this.events.push('start');
  }

  @Command('ping', { description: 'Ping the bot' })
  public onPing(_ctx: Context): void {
    this.events.push('ping');
  }
}

/** Named-bot handler provider; must bind only on the `admin` runtime bot. */
@TelegramUpdate({ bot: 'admin' })
@Injectable()
class AdminUpdate {
  /** Ordered record of which handlers fired. */
  public readonly events: string[] = [];

  @Command('promote')
  public onPromote(_ctx: Context): void {
    this.events.push('promote');
  }
}

/**
 * Compiles a `forRootRuntime` module over a capturing `botFactory` and returns the
 * manager plus the list of fake instances it has built (newest last).
 *
 * @param opts - Optional name, launch flag, commands auto-register, and providers.
 * @returns The resolved manager, the built-instance list, and the module ref.
 */
async function bootstrapRuntime(
  opts: {
    name?: string;
    launch?: boolean;
    autoRegister?: boolean;
    providers?: ReadonlyArray<new () => object>;
  } = {},
): Promise<{
  runtime: TelegramBotRuntime;
  built: MockTelegraf[];
  close: () => Promise<void>;
}> {
  const built: MockTelegraf[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [
      TelegramBotModule.forRootRuntime({
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.launch !== undefined && { launch: opts.launch }),
        ...(opts.autoRegister && { commands: { autoRegister: true } }),
        botFactory: () => {
          const bot = createMockTelegraf();
          built.push(bot);
          return asTelegraf(bot);
        },
      }),
    ],
    providers: [...(opts.providers ?? [DefaultUpdate])],
  }).compile();

  const runtime = moduleRef.get<TelegramBotRuntime>(
    getBotRuntimeToken(opts.name),
    { strict: false },
  );
  return { runtime, built, close: () => moduleRef.close() };
}

/** Lets queued microtasks (e.g. the non-awaited launch `.catch`) run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('TelegramBotRuntime', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // ── Keep the binding/launch log lines out of the test output. ──────────────
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('starts offline and throws a clear error from the accessors before configure', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      expect(runtime.getStatus()).toEqual({
        status: BOT_RUNTIME_STATUSES.OFFLINE,
      });
      expect(runtime.isConfigured).toBe(false);
      expect(built).toHaveLength(0);
      expect(() => runtime.instance).toThrow(TelegramConfigError);
      expect(() => runtime.telegram).toThrow(TelegramConfigError);
      expect(() => runtime.service).toThrow(/not configured/);
    } finally {
      await close();
    }
  });

  it('configures at runtime: builds, binds handlers, validates, launches, online', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      const status = await runtime.configure({ token: '123:abc' });

      expect(built).toHaveLength(1);
      const bot = built[0]!;
      // ── Decorator handlers were bound onto the freshly built instance. ───────
      expect(bot.start).toHaveBeenCalledTimes(1);
      expect(bot.command).toHaveBeenCalledWith('ping', expect.any(Function));
      // ── Token validated via getMe, then launched (long-polling). ────────────
      expect(bot.telegram.getMe).toHaveBeenCalledTimes(1);
      expect(bot.launch).toHaveBeenCalledTimes(1);

      expect(status).toEqual({
        status: BOT_RUNTIME_STATUSES.ONLINE,
        botUsername: 'mock_bot',
      });
      expect(runtime.isConfigured).toBe(true);
      expect(runtime.instance).toBe(asTelegraf(bot));
      expect(runtime.telegram).toBe(bot.telegram);
    } finally {
      await close();
    }
  });

  it('binds without launching when launch is false (manual/webhook control)', async () => {
    const { runtime, built, close } = await bootstrapRuntime({ launch: false });
    try {
      const status = await runtime.configure({ token: '123:abc' });
      const bot = built[0]!;
      expect(bot.command).toHaveBeenCalledWith('ping', expect.any(Function));
      expect(bot.telegram.getMe).toHaveBeenCalledTimes(1);
      expect(bot.launch).not.toHaveBeenCalled();
      // ── Still configured + validated; just not polling. ──────────────────────
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ONLINE);
      expect(runtime.isConfigured).toBe(true);
    } finally {
      await close();
    }
  });

  it('setToken is a thin wrapper over configure', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      const status = await runtime.setToken('123:abc');
      expect(built).toHaveLength(1);
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ONLINE);
    } finally {
      await close();
    }
  });

  it('rotates the token: stops the old instance and rebinds onto a fresh one', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      await runtime.configure({ token: 'old:token' });
      const first = built[0]!;
      await runtime.configure({ token: 'new:token' });
      const second = built[1]!;

      expect(built).toHaveLength(2);
      expect(first).not.toBe(second);
      // ── Old poller stopped; new instance rebound + relaunched. ───────────────
      expect(first.stop).toHaveBeenCalledTimes(1);
      expect(second.command).toHaveBeenCalledWith('ping', expect.any(Function));
      expect(second.launch).toHaveBeenCalledTimes(1);
      expect(runtime.instance).toBe(asTelegraf(second));
      expect(runtime.getStatus().status).toBe(BOT_RUNTIME_STATUSES.ONLINE);
    } finally {
      await close();
    }
  });

  it('reports error (never throws) on a blank token, leaving the bot unconfigured', async () => {
    const { runtime, close } = await bootstrapRuntime();
    try {
      const status = await runtime.configure({ token: '   ' });
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ERROR);
      expect(status.lastError).toMatch(/non-empty/i);
      expect(runtime.isConfigured).toBe(false);
      expect(() => runtime.instance).toThrow(TelegramConfigError);
    } finally {
      await close();
    }
  });

  it('reports error on a revoked token (getMe rejects), never throwing', async () => {
    const built: MockTelegraf[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRootRuntime({
          botFactory: () => {
            const bot = createMockTelegraf({
              telegram: {
                getMe: jest
                  .fn()
                  .mockRejectedValue(new Error('401: Unauthorized')),
                setMyCommands: jest.fn().mockResolvedValue(true),
              },
            });
            built.push(bot);
            return asTelegraf(bot);
          },
        }),
      ],
      providers: [DefaultUpdate],
    }).compile();
    try {
      const runtime = moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
        strict: false,
      });
      const status = await runtime.configure({ token: '123:abc' });
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ERROR);
      expect(status.lastError).toMatch(/401/);
      // ── A bad token never goes live: the bot is not launched, not configured. ─
      expect(built[0]!.launch).not.toHaveBeenCalled();
      expect(runtime.isConfigured).toBe(false);
    } finally {
      await moduleRef.close();
    }
  });

  it('surfaces a single-poller 409 launch conflict as error status', async () => {
    const built: MockTelegraf[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRootRuntime({
          botFactory: () => {
            const bot = createMockTelegraf({
              launch: jest
                .fn()
                .mockRejectedValue(
                  new Error(
                    '409: Conflict: terminated by other getUpdates request',
                  ),
                ),
            });
            built.push(bot);
            return asTelegraf(bot);
          },
        }),
      ],
      providers: [DefaultUpdate],
    }).compile();
    try {
      const runtime = moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
        strict: false,
      });
      // ── getMe succeeds (token valid) → online; then the non-awaited launch
      //    rejects with 409 on the next microtask → error. ──────────────────────
      await runtime.configure({ token: '123:abc' });
      await flushMicrotasks();

      const status = runtime.getStatus();
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ERROR);
      expect(status.lastError).toMatch(/409|another poller/i);
    } finally {
      await moduleRef.close();
    }
  });

  it('clear() stops and drops the instance, returning to offline', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      await runtime.configure({ token: '123:abc' });
      const bot = built[0]!;
      const status = await runtime.clear();

      expect(bot.stop).toHaveBeenCalledTimes(1);
      expect(status).toEqual({ status: BOT_RUNTIME_STATUSES.OFFLINE });
      expect(runtime.isConfigured).toBe(false);
      expect(() => runtime.instance).toThrow(TelegramConfigError);
    } finally {
      await close();
    }
  });

  it('stop() halts polling but keeps the instance accessible', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      await runtime.configure({ token: '123:abc' });
      const bot = built[0]!;
      const status = await runtime.stop();

      expect(bot.stop).toHaveBeenCalledTimes(1);
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.OFFLINE);
      // ── Instance retained: one-off API calls still work after stop(). ────────
      expect(runtime.isConfigured).toBe(true);
      expect(runtime.instance).toBe(asTelegraf(bot));
    } finally {
      await close();
    }
  });

  it('syncs the @Command menu when commands.autoRegister is enabled', async () => {
    const { runtime, built, close } = await bootstrapRuntime({
      autoRegister: true,
    });
    try {
      await runtime.configure({ token: '123:abc' });
      // ── The described @Command('ping', { description }) is synced post-launch. ─
      const setMyCommands = built[0]!.telegram.setMyCommands as jest.Mock;
      expect(setMyCommands).toHaveBeenCalledTimes(1);
      const [commands] = setMyCommands.mock.calls[0]!;
      expect(commands).toEqual([
        { command: 'ping', description: 'Ping the bot' },
      ]);
    } finally {
      await close();
    }
  });

  it('isolates named runtime bots: only matching-bot handlers bind', async () => {
    const { runtime, built, close } = await bootstrapRuntime({
      name: 'admin',
      providers: [DefaultUpdate, AdminUpdate],
    });
    try {
      await runtime.configure({ token: '123:abc' });
      const bot = built[0]!;
      // ── Only @TelegramUpdate({ bot: 'admin' })'s @Command('promote') binds;
      //    the default bot's @Command('ping') and @Start() do not. ──────────────
      expect(bot.command).toHaveBeenCalledTimes(1);
      expect(bot.command).toHaveBeenCalledWith('promote', expect.any(Function));
      expect(bot.start).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('stops the bot on module destroy (app.close)', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    await runtime.configure({ token: '123:abc' });
    const bot = built[0]!;
    await close();
    expect(bot.stop).toHaveBeenCalled();
  });

  it('onApplicationShutdown stops the running bot', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      await runtime.configure({ token: '123:abc' });
      await runtime.onApplicationShutdown('SIGTERM');
      expect(built[0]!.stop).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it('exposes the typed facade (service) over the current instance', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      await runtime.configure({ token: '123:abc' });
      // ── The facade delegates getMe to the current instance's telegram. ───────
      await runtime.service.getMe();
      expect(built[0]!.telegram.getMe).toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('stop() and clear() are safe no-ops before any configure', async () => {
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      expect((await runtime.stop()).status).toBe(BOT_RUNTIME_STATUSES.OFFLINE);
      expect((await runtime.clear()).status).toBe(BOT_RUNTIME_STATUSES.OFFLINE);
      expect(built).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('swallows a benign stop error and logs a warning', async () => {
    const built: MockTelegraf[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRootRuntime({
          botFactory: () => {
            const bot = createMockTelegraf({
              stop: jest.fn(() => {
                throw new Error('Bot is not running!');
              }),
            });
            built.push(bot);
            return asTelegraf(bot);
          },
        }),
      ],
      providers: [DefaultUpdate],
    }).compile();
    try {
      const runtime = moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
        strict: false,
      });
      await runtime.configure({ token: '123:abc' });
      // ── clear() must not throw even though stop() does. ──────────────────────
      await expect(runtime.clear()).resolves.toEqual({
        status: BOT_RUNTIME_STATUSES.OFFLINE,
      });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it('honors per-configure overrides (launch:false on a launch-by-default bot)', async () => {
    // ── Base leaves launch at its default (true); the override disables it. ────
    const { runtime, built, close } = await bootstrapRuntime();
    try {
      await runtime.configure({ token: '123:abc', launch: false });
      expect(built[0]!.launch).not.toHaveBeenCalled();
      expect(runtime.getStatus().status).toBe(BOT_RUNTIME_STATUSES.ONLINE);
    } finally {
      await close();
    }
  });

  it.each([
    ['a numeric code', { code: 409 }],
    ['a nested response error_code', { response: { error_code: 409 } }],
  ])('detects a 409 conflict via %s', async (_label, extra) => {
    const built: MockTelegraf[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [
        TelegramBotModule.forRootRuntime({
          botFactory: () => {
            // ── A non-409 message forces detection via the numeric fields. ─────
            const bot = createMockTelegraf({
              launch: jest
                .fn()
                .mockRejectedValue(Object.assign(new Error('boom'), extra)),
            });
            built.push(bot);
            return asTelegraf(bot);
          },
        }),
      ],
      providers: [DefaultUpdate],
    }).compile();
    try {
      const runtime = moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
        strict: false,
      });
      await runtime.configure({ token: '123:abc' });
      await flushMicrotasks();
      const status = runtime.getStatus();
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ERROR);
      expect(status.lastError).toMatch(/another poller/i);
    } finally {
      await moduleRef.close();
    }
  });

  it('falls back to createTelegrafInstance when no botFactory is given', async () => {
    // ── Spy the factory module so the default thunk runs without building a real
    //    Telegraf (which would need the network at getMe/launch). ───────────────
    const factory = jest.requireActual<
      typeof import('../telegram-bot.factory')
    >('../telegram-bot.factory');
    const spy = jest
      .spyOn(factory, 'createTelegrafInstance')
      .mockImplementation(() => asTelegraf(createMockTelegraf()));

    const moduleRef = await Test.createTestingModule({
      imports: [TelegramBotModule.forRootRuntime({})],
      providers: [DefaultUpdate],
    }).compile();
    try {
      const runtime = moduleRef.get<TelegramBotRuntime>(getBotRuntimeToken(), {
        strict: false,
      });
      const status = await runtime.configure({ token: '123:abc' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(status.status).toBe(BOT_RUNTIME_STATUSES.ONLINE);
    } finally {
      await moduleRef.close();
      spy.mockRestore();
    }
  });
});
